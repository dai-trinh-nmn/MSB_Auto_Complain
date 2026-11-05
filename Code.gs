/** MSB Auto Complain 1.0.0 */
const MSB_VERSION = "1.0.0";

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Thiếu SPREADSHEET_ID. Chạy setupSpreadsheet từ trình soạn thảo gắn với Sheet.");
  return SpreadsheetApp.openById(id);
}

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Mở Google Sheet > Tiện ích mở rộng > Apps Script, hoặc tự đặt SPREADSHEET_ID trong Script Properties.");
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());
  Logger.log("Đã lưu SPREADSHEET_ID. Tiếp theo: triển khai Web App và đặt WEB_APP_URL trong Script Properties.");
}

function getSystemData() {
  const ss = getSpreadsheet_();
  const configSheet = ss.getSheetByName("Cai_Dat");
  if (!configSheet) throw new Error("Không tìm thấy tab Cai_Dat.");
  const config = {
    TEN_CHU_THE: "", SO_DIEN_THOAI: "", SO_GIAY_TO: "", EMAIL_CSKH_MSB: "",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", hasTelegram: false
  };
  configSheet.getDataRange().getValues().forEach(row => {
    const key = String(row[0]).trim();
    if (key !== "hasTelegram" && Object.prototype.hasOwnProperty.call(config, key)) {
      config[key] = String(row[1] == null ? "" : row[1]).trim();
    }
  });

  const props = PropertiesService.getScriptProperties();
  ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].forEach(key => {
    const value = props.getProperty(key);
    if (value) config[key] = value.trim();
  });
  config.hasTelegram = Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
  const cardsSheet = ss.getSheetByName("Danh_Sach_The");
  if (!cardsSheet) throw new Error("Không tìm thấy tab Danh_Sach_The.");
  const cards = [];
  cardsSheet.getDataRange().getValues().slice(1).forEach(row => {
    const alias = String(row[0]).trim().toUpperCase();
    const name = String(row[1]).trim();
    const rawLast4 = String(row[2]).trim();
    if (alias && name && rawLast4) {
      if (!/^[A-Z0-9_]{1,24}$/.test(alias)) throw new Error("Alias thẻ chỉ được dùng A-Z, 0-9, dấu gạch dưới (tối đa 24 ký tự).");
      if (!/^\d{1,4}$/.test(rawLast4)) throw new Error("4 số cuối thẻ phải có 1 đến 4 chữ số.");
      if (cards.some(card => card.alias === alias)) throw new Error("Danh_Sach_The có alias trùng.");
      cards.push({ alias, name, last4: rawLast4.padStart(4, "0"), statementDay: row[3], pointDay: row[4] });
    }
  });
  return { config, cards };
}

function parseDate(input) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string") return null;
  const str = input.trim();
  let parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (parts) parts = [Number(parts[3]), Number(parts[2]), Number(parts[1])];
  else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!iso) return null;
    parts = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  }
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function escapeHtml_(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeError_(error) {
  return String(error && error.message || error)
    .replace(/https:\/\/api\.telegram\.org\/bot[^\s/]+/g, "[Telegram API]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]+\b/g, "[TOKEN]")
    .replace(/([?&]key=)[^&\s]+/g, "$1[REDACTED]").slice(0, 800);
}

function telegramApi_(method, payload, config) {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error("Thiếu TELEGRAM_BOT_TOKEN.");
  let response;
  try {
    response = UrlFetchApp.fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload || {}), muteHttpExceptions: true
    });
  } catch (error) {
    // Không truyền lỗi fetch nguyên bản vì lỗi có thể chứa URL và token.
    throw new Error(`Telegram ${method}: không kết nối được API.`);
  }
  const code = response.getResponseCode();
  let body;
  try { body = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error(`Telegram ${method}: HTTP ${code}, phản hồi không phải JSON.`); }
  if (code < 200 || code >= 300 || body.ok !== true) {
    throw new Error(safeError_(`Telegram ${method}: HTTP ${code}; ${body.description || "API từ chối yêu cầu"}`));
  }
  return body.result;
}

function sendTelegram(text, replyMarkup = null, config = null) {
  config = config || getSystemData().config;
  if (!config.hasTelegram) throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID.");
  const payload = { chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi_("sendMessage", payload, config);
}

function getTrackingSheet_() {
  const sheet = getSpreadsheet_().getSheetByName("Theo_Doi_Hoan_Tien");
  if (!sheet) throw new Error("Không tìm thấy tab Theo_Doi_Hoan_Tien.");
  return sheet;
}

function trackingFormulas_(row) {
  return {
    last4: `=IF(B${row}="";"";XLOOKUP(B${row};Danh_Sach_The!$B$2:$B;Danh_Sach_The!$C$2:$C;""))`,
    due: `=IF(D${row}="";"";WORKDAY(D${row};60;Ngay_Le!$A$2:$A$300))`
  };
}

function repairTrackingFormulas() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getTrackingSheet_();
    const rows = sheet.getDataRange().getValues();
    let count = 0;
    rows.forEach((row, i) => {
      if (i === 0 || row[0] === "" || row[0] == null) return;
      const formulas = trackingFormulas_(i + 1);
      sheet.getRange(i + 1, 3).setNumberFormat("0000").setFormula(formulas.last4);
      sheet.getRange(i + 1, 6).setNumberFormat("dd/MM/yyyy").setFormula(formulas.due);
      count++;
    });
    SpreadsheetApp.flush();
    Logger.log(`Đã sửa công thức cột C và F cho ${count} bản ghi.`);
    return count;
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  // ContentService chuyển hướng sang googleusercontent; Telegram cần phản hồi 2xx.
  // Dùng HtmlOutput cho ACK; vẫn kiểm tra HTTP thực tế qua getWebhookInfo sau deploy.
  const ok = () => HtmlService.createHtmlOutput("OK");
  if (!e || !e.postData || !e.postData.contents) return ok();
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("WEBHOOK_KEY");
  // Apps Script không cung cấp header webhook trong event; dùng khóa ở query string.
  // Chỉ nhận webhook sau khi setTelegramWebhook đã tạo khóa.
  if (!secret || !e.parameter || e.parameter.key !== secret) return ok();
  const lock = LockService.getScriptLock();
  try {
    const update = JSON.parse(e.postData.contents);
    if (!Number.isSafeInteger(update.update_id)) return ok();
    const { config, cards } = getSystemData();
    if (!config.hasTelegram) throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID.");
    const source = update.callback_query ? update.callback_query.message : update.message;
    if (!source || !source.chat || String(source.chat.id) !== config.TELEGRAM_CHAT_ID) return ok();
    const kind = update.callback_query ? "callback_query" : "message";
    props.setProperty("LAST_WEBHOOK_RECEIVED", JSON.stringify({ at: new Date().toISOString(), updateId: update.update_id, kind, version: MSB_VERSION }));
    // Đóng spinner trước khi đợi lock/ghi Sheet. Callback hết hạn không chặn phần xử lý.
    if (update.callback_query) {
      try { telegramApi_("answerCallbackQuery", { callback_query_id: update.callback_query.id }, config); }
      catch (error) { Logger.log(safeError_(error)); }
    }
    lock.waitLock(10000);
    const processed = JSON.parse(props.getProperty("PROCESSED_TELEGRAM_UPDATES") || "[]");
    const updateId = String(update.update_id);
    if (processed.includes(updateId)) return ok();
    if (update.callback_query) handleCallback_(update.callback_query, cards, config);
    else if (typeof update.message.text === "string") handleMessage_(update.message.text, updateId, cards, config);
    SpreadsheetApp.flush();
    // Chỉ đánh dấu sau khi thành công; dùng Properties + lock thay cho Cache 120 giây.
    props.setProperty("PROCESSED_TELEGRAM_UPDATES", JSON.stringify(processed.concat(updateId).slice(-100)));
    props.setProperty("LAST_WEBHOOK_SUCCESS", JSON.stringify({ at: new Date().toISOString(), updateId, kind, version: MSB_VERSION }));
    props.deleteProperty("LAST_WEBHOOK_ERROR");
    return ok();
  } catch (error) {
    const message = safeError_(error);
    props.setProperty("LAST_WEBHOOK_ERROR", JSON.stringify({ at: new Date().toISOString(), message, version: MSB_VERSION }));
    Logger.log("Lỗi doPost: " + message);
    // Để Execution hiển thị Failed, thay vì nuốt lỗi rồi báo OK.
    throw new Error(message);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function handleCallback_(cb, cards, config) {
  const [action, value] = String(cb.data || "").split(":");
  if (action === "select_card") {
    const card = cards.find(c => c.alias === value);
    if (!card) return sendTelegram("⚠️ Thẻ không còn hoạt động. Gửi /them để lấy menu mới.", null, config);
    return sendTelegram(
      `💳 Bạn đã chọn: <b>${escapeHtml_(card.name)}</b> (đuôi ${card.last4}).\n\n` +
      `👉 Đổi hôm nay:\n<code>/doi ${card.alias} 300000</code>\n` +
      `Nếu đổi ngày khác:\n<code>/doi ${card.alias} 05/11/2026 300000</code>\n` +
      `Bỏ ngày sẽ mặc định hôm nay theo múi giờ Sheet. Số tiền dùng chữ số, không có dấu phân cách.`, null, config);
  }
  if (action === "danhan" || action === "huy") {
    const sheet = getTrackingSheet_();
    const rows = sheet.getDataRange().getValues();
    const index = rows.findIndex((row, i) => i > 0 && String(row[0]) === value);
    if (index < 0) return sendTelegram("⚠️ Không tìm thấy bản ghi. Gửi /ds để kiểm tra.", null, config);
    const current = rows[index][6];
    const status = action === "danhan" ? "Đã nhận" : "Hủy";
    if (current !== status && current !== "Chờ hoàn" && current !== "Đã khiếu nại") {
      return sendTelegram(`⚠️ Bản ghi đã có trạng thái <b>${escapeHtml_(current)}</b>; hãy sửa trên Sheet nếu cần.`, null, config);
    }
    sheet.getRange(index + 1, 7).setValue(status);
    return sendTelegram(`✅ Đã cập nhật <code>${escapeHtml_(value)}</code>: <b>${status}</b>.`, null, config);
  }
  return sendTelegram("⚠️ Nút không còn hợp lệ. Gửi /them để lấy menu mới.", null, config);
}

function handleMessage_(text, updateId, cards, config) {
  const p = text.trim().split(/\s+/);
  const command = p[0].split("@")[0].toLowerCase();
  if (command === "/start" || command === "/them") {
    if (!cards.length) return sendTelegram("⚠️ Điền 4 số cuối thẻ ở cột C tab Danh_Sach_The để kích hoạt thẻ.", null, config);
    return sendTelegram(
      `👋 Chào <b>${escapeHtml_(config.TEN_CHU_THE || "bạn")}</b>!\n` +
      `Bạn đang có <b>${cards.length} thẻ</b> MSB. Chọn thẻ vừa đổi điểm:`,
      { inline_keyboard: cards.map(c => [{ text: `💳 ${c.name} (..${c.last4})`, callback_data: `select_card:${c.alias}` }]) }, config);
  }
  if (command === "/doi") {
    if (p.length !== 3 && p.length !== 4) return sendTelegram("⚠️ Cú pháp: <code>/doi VISAONL 300000</code> (hôm nay) hoặc <code>/doi VISAONL dd/MM/yyyy 300000</code>.", null, config);
    const alias = p[1].toUpperCase();
    const card = cards.find(c => c.alias === alias);
    if (!card) return sendTelegram(`❌ Không tìm thấy thẻ đang hoạt động: <code>${escapeHtml_(alias)}</code>.`, null, config);
    const ss = getSpreadsheet_();
    const timezone = ss.getSpreadsheetTimeZone();
    const dateInput = p.length === 3 ? "homnay" : p[2];
    const amountInput = p.length === 3 ? p[2] : p[3];
    const dateText = dateInput.toLowerCase() === "homnay" ? Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy") : dateInput;
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateText) || !parseDate(dateText)) {
      return sendTelegram("⚠️ Ngày không hợp lệ. Dùng dd/MM/yyyy hoặc homnay.", null, config);
    }
    const amount = Number(amountInput);
    if (!/^\d+$/.test(amountInput) || !Number.isSafeInteger(amount) || amount <= 0) {
      return sendTelegram("⚠️ Số tiền phải là số nguyên dương, ví dụ 300000 (không nhập 300k hoặc 300.000).", null, config);
    }
    // Parse trong múi giờ của Sheet; tránh lưu chuỗi ngày phụ thuộc locale.
    const date = Utilities.parseDate(dateText, timezone, "dd/MM/yyyy");
    const canonicalDate = Utilities.formatDate(date, timezone, "dd/MM/yyyy");
    // update_id giúp retry không thêm dòng và cho phép đổi nhiều lần trong một ngày.
    const id = `${card.alias}_${canonicalDate.replace(/\//g, "")}_${updateId}`;
    const sheet = getTrackingSheet_();
    if (!ss.getSheetByName("Ngay_Le")) throw new Error("Không tìm thấy tab Ngay_Le.");
    const rows = sheet.getDataRange().getValues();
    if (!rows.some(row => String(row[0]) === id)) {
      // Bỏ qua công thức F có sẵn tới hàng 1000; ghi sau dòng dữ liệu cuối cùng.
      let last = 0;
      rows.forEach((row, i) => {
        if (row.some((value, col) => col < 8 && col !== 5 && value !== "" && value != null)) last = i;
      });
      const next = Math.max(2, last + 2);
      if (next > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), next - sheet.getMaxRows());
      // Ghi cả bản ghi và công thức bằng một thao tác.
      const formulas = trackingFormulas_(next);
      sheet.getRange(next, 3).setNumberFormat("0000");
      sheet.getRange(next, 1, 1, 8).setValues([[
        id, card.name, formulas.last4, date, amount,
        formulas.due, "Chờ hoàn", ""
      ]]);
      sheet.getRange(next, 4).setNumberFormat("dd/MM/yyyy");
      sheet.getRange(next, 6).setNumberFormat("dd/MM/yyyy");
      SpreadsheetApp.flush();
    }
    return sendTelegram(
      `🎉 <b>Đã ghi nhận kỳ hoàn tiền!</b>\n• ID: <code>${id}</code>\n` +
      `• Thẻ: <b>${escapeHtml_(card.name)}</b> (..${card.last4})\n` +
      `• Ngày đổi: <b>${canonicalDate}</b>\n• Số tiền: <b>${amount.toLocaleString("vi-VN")} VND</b>`,
      { inline_keyboard: [[{ text: "✅ Đã nhận tiền", callback_data: `danhan:${id}` }, { text: "❌ Hủy theo dõi", callback_data: `huy:${id}` }]] }, config);
  }
  if (command === "/ds") {
    const rows = getTrackingSheet_().getDataRange().getValues().slice(1).filter(row => row[6] === "Chờ hoàn" || row[6] === "Đã khiếu nại");
    if (!rows.length) return sendTelegram("Bạn không có khoản hoàn tiền nào cần theo dõi.", null, config);
    // Một tin mỗi bản ghi tránh vượt giới hạn text 4096 ký tự của Telegram.
    rows.forEach(row => {
      const date = parseDate(row[5]);
      const due = date ? Utilities.formatDate(date, getSpreadsheet_().getSpreadsheetTimeZone(), "dd/MM/yyyy") : "Đang tính";
      sendTelegram(`📋 <code>${escapeHtml_(row[0])}</code>\n<b>${escapeHtml_(row[1])}</b> (..${escapeHtml_(row[2])})\n` +
        `${Number(row[4]).toLocaleString("vi-VN")} đ — Hạn: ${due}\nTrạng thái: ${escapeHtml_(row[6])}`,
        { inline_keyboard: [[{ text: "✅ Đã nhận tiền", callback_data: `danhan:${row[0]}` }, { text: "❌ Hủy theo dõi", callback_data: `huy:${row[0]}` }]] }, config);
    });
    return;
  }
  return sendTelegram("Gửi /them để chọn thẻ, /doi để ghi nhận đổi điểm, hoặc /ds để xem danh sách.", null, config);
}


// 4. HÀM CHẠY TỰ ĐỘNG HÀNG NGÀY (KIỂM TRA HẠN & GỬI EMAIL ĐÒI TIỀN)
function kiemTraVaGuiEmailKhieuNai() {
  const { config } = getSystemData();
  if (!config.EMAIL_CSKH_MSB) throw new Error("Điền EMAIL_CSKH_MSB trong Cai_Dat trước khi gửi email.");
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("Theo_Doi_Hoan_Tien");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const timezone = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = row[0];
    const dongThe = row[1];
    const soTheCuoi = row[2];
    const rawNgayDoi = row[3];
    const soTien = row[4];
    const rawNgayDenHan = row[5];
    const trangThai = row[6];

    if (trangThai === "Chờ hoàn") {
      const parsedNgayDenHan = parseDate(rawNgayDenHan);
      const parsedNgayDoi = parseDate(rawNgayDoi);

      if (parsedNgayDenHan) {
        const dueDate = new Date(parsedNgayDenHan);
        const dueDay = Utilities.formatDate(dueDate, timezone, "yyyy-MM-dd");

        // Chỉ gửi sau ngày hạn chót, không gửi ngay trong ngày ngân hàng còn thời gian trả.
        if (today > dueDay) {
          const ngayDoiFormatted = parsedNgayDoi ? Utilities.formatDate(parsedNgayDoi, timezone, "dd/MM/yyyy") : "Chưa rõ";
          const ngayHanFormatted = Utilities.formatDate(dueDate, timezone, "dd/MM/yyyy");

          const subject = `V/v Yêu cầu thanh toán tiền hoàn thẻ tín dụng quá hạn xử lý`;
          const htmlBody = `
            <p>Kính gửi <b>Bộ phận Chăm sóc Khách hàng Ngân hàng TMCP Hàng Hải Việt Nam (MSB)</b>,</p>
            <p>Tôi là <b>${config.TEN_CHU_THE}</b>, số điện thoại <b>${config.SO_DIEN_THOAI}</b>, số giấy tờ <b>${config.SO_GIAY_TO}</b>, chủ thẻ tín dụng MSB,:</p>
            <ul>
              <li><b>Dòng thẻ:</b> ${dongThe}</li>
              <li><b>4 số cuối thẻ:</b> ${soTheCuoi}</li>
              <li><b>Ngày thực hiện đổi điểm trên ứng dụng:</b> ${ngayDoiFormatted}</li>
              <li><b>Số tiền hoàn:</b> ${Number(soTien).toLocaleString('vi-VN')} VND</li>
              <li><b>Hạn chót chi trả theo quy định (60 ngày làm việc):</b> ${ngayHanFormatted}</li>
            </ul>
            <p>Tính đến thời điểm hiện tại, thời hạn xử lý hoàn tiền tối đa 60 ngày làm việc đã hết, tuy nhiên tài khoản thẻ của tôi vẫn chưa nhận được khoản tiền hoàn nói trên.</p>
            <p>Kính đề nghị Ngân hàng MSB thực hiện kiểm tra và giải ngân ngay khoản tiền này vào thẻ tín dụng cho tôi, đồng thời phản hồi tiến độ bằng văn bản qua email trong vòng <b>24 - 48 giờ làm việc</b>.</p>
            <p>Trân trọng,<br><b>${config.TEN_CHU_THE}</b></p>
          `;

          // Chỉ gửi tới địa chỉ được cấu hình; không tự CC cho người gửi.
          GmailApp.sendEmail(config.EMAIL_CSKH_MSB, subject, "", {
            htmlBody: htmlBody
          });

          // Cập nhật trạng thái trong Sheet để tránh gửi lặp lại vào ngày mai
          sheet.getRange(i + 1, 7).setValue("Đã khiếu nại");
          sheet.getRange(i + 1, 8).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"));

          // Nếu có dùng Telegram, bắn thông báo cảnh báo về điện thoại của bạn
          if (config.hasTelegram) {
            try {
              sendTelegram(
                `🚨 <b>ĐÃ TỰ ĐỘNG GỬI EMAIL KHIẾU NẠI ĐÒI TIỀN MSB!</b>\n\n` +
                `• Mã ID: <code>${id}</code>\n` +
                `• Thẻ: <b>${dongThe}</b> (..${soTheCuoi})\n` +
                `• Số tiền hoàn: <b>${Number(soTien).toLocaleString('vi-VN')} đ</b>\n` +
                `• Lý do: Đã quá hạn 60 ngày làm việc (Hạn chót: ${ngayHanFormatted}) nhưng chưa được chi trả.`,
                null, config
              );
            } catch (error) {
              // Email đã gửi và trạng thái đã cập nhật; lỗi thông báo không chặn các dòng tiếp theo.
              Logger.log("Email đã gửi, lỗi thông báo Telegram: " + safeError_(error));
            }
          }
        }
      }
    }
  }
}

// 5. Chạy thủ công sau khi cập nhật phiên bản triển khai Web App.
function setTelegramWebhook() {
  const { config } = getSystemData();
  if (!config.hasTelegram) throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID.");
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty("WEB_APP_URL") || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    throw new Error("Đặt WEB_APP_URL trong Script Properties bằng URL triển khai kết thúc /exec (không dùng /dev).");
  }
  let key = props.getProperty("WEBHOOK_KEY");
  if (!key) {
    key = Utilities.getUuid();
    props.setProperty("WEBHOOK_KEY", key);
  }
  telegramApi_("setWebhook", {
    url: `${url}?key=${encodeURIComponent(key)}`,
    allowed_updates: ["message", "callback_query"], max_connections: 1,
    drop_pending_updates: false
  }, config);
  Logger.log("Đã đăng ký webhook cho message và callback_query; không xóa update đang chờ. Chạy diagnoseTelegram để kiểm tra.");
}

// Chỉ đọc cấu hình/trạng thái; không gửi Telegram, không gửi email.
function diagnoseTelegram() {
  const { config, cards } = getSystemData();
  const props = PropertiesService.getScriptProperties();
  const me = telegramApi_("getMe", {}, config);
  const info = telegramApi_("getWebhookInfo", {}, config);
  const expected = (props.getProperty("WEB_APP_URL") || "").trim();
  const expectedKey = props.getProperty("WEBHOOK_KEY");
  const report = {
    editorVersion: MSB_VERSION, botUsername: me.username,
    hasChatId: Boolean(config.TELEGRAM_CHAT_ID), activeCards: cards.length,
    trackingSheetExists: Boolean(getSpreadsheet_().getSheetByName("Theo_Doi_Hoan_Tien")),
    timezone: getSpreadsheet_().getSpreadsheetTimeZone(),
    webhookConfigured: Boolean(info.url),
    webhookMatches: Boolean(expected && expectedKey && info.url === `${expected}?key=${encodeURIComponent(expectedKey)}`),
    allowedUpdates: info.allowed_updates || "Telegram default",
    pendingUpdates: info.pending_update_count,
    lastDeliveryError: safeError_(info.last_error_message || ""),
    lastDeliveryErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    lastReceived: props.getProperty("LAST_WEBHOOK_RECEIVED"),
    lastSuccess: props.getProperty("LAST_WEBHOOK_SUCCESS"),
    lastHandlerError: props.getProperty("LAST_WEBHOOK_ERROR")
  };
  // Không log info.url vì query string chứa WEBHOOK_KEY.
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
