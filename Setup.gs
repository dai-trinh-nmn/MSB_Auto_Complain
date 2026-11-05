/** MSB Auto Complain 1.0.0 */

function initializeNewAccount() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Mở Sheet đã chuyển sang Google Sheets > Extensions > Apps Script.");
  const required = {
    Theo_Doi_Hoan_Tien: ["ID", "Thẻ", "4 số cuối", "Ngày đổi điểm", "Số tiền hoàn", "Hạn chót", "Trạng thái", "Ngày gửi email"],
    Cai_Dat: ["TEN_CHU_THE"], Danh_Sach_The: ["Alias", "Tên thẻ", "4 số cuối"], Ngay_Le: ["Ngày", "Tên Ngày Lễ"]
  };
  Object.keys(required).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error(`Thiếu tab ${name}. Hãy import đúng template.`);
    const row = sheet.getDataRange().getValues()[0] || [];
    required[name].forEach((value, i) => {
      if (String(row[i]).trim() !== value) throw new Error(`Sai tiêu đề ${name}, cột ${i + 1}; cần ${value}.`);
    });
  });
  const sheet = ss.getSheetByName("Theo_Doi_Hoan_Tien");
  if (sheet.getDataRange().getValues().slice(1).some(row => row[0] !== "" && row[0] != null)) {
    throw new Error("Sheet đã có ID bản ghi. Không khởi tạo lại; dùng repairTrackingFormulas nếu cần sửa C/F.");
  }
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());
  ss.setSpreadsheetLocale("vi_VN");
  ss.setSpreadsheetTimeZone("Asia/Ho_Chi_Minh");
  if (sheet.getMaxRows() < 201) sheet.insertRowsAfter(sheet.getMaxRows(), 201 - sheet.getMaxRows());
  const last4 = [], due = [];
  for (let row = 2; row <= 201; row++) {
    const formulas = trackingFormulas_(row);
    last4.push([formulas.last4]); due.push([formulas.due]);
  }
  sheet.getRange("C2:C201").setNumberFormat("0000").setFormulas(last4);
  sheet.getRange("F2:F201").setNumberFormat("dd/MM/yyyy").setFormulas(due);
  sheet.getRange("D2:D201").setNumberFormat("dd/MM/yyyy");
  sheet.getRange("E2:E201").setNumberFormat('#,##0" đ"');
  const names = ss.getSheetByName("Danh_Sach_The").getDataRange().getValues().slice(1)
    .filter(row => row[1] && row[2] !== "" && row[2] != null).map(row => String(row[1]).trim());
  if (names.length) sheet.getRange("B2:B201").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(names, true).setAllowInvalid(false).build());
  sheet.getRange("G2:G201").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["Chờ hoàn", "Đã khiếu nại", "Đã nhận", "Hủy"], true).setAllowInvalid(false).build());
  Object.keys(required).forEach(name => ss.getSheetByName(name).setFrozenRows(1));
  SpreadsheetApp.flush();
  Logger.log("Đã khởi tạo locale Việt Nam, múi giờ, ID và công thức C/F. Chưa gửi email, chưa tạo trigger hoặc webhook.");
  return checkNewAccountSetup();
}

// Lấy Chat ID trước khi đăng ký webhook. Không xóa webhook hay xác nhận/xóa update.
function findTelegramChatId() {
  const { config } = getSystemData();
  telegramApi_("getMe", {}, config);
  const info = telegramApi_("getWebhookInfo", {}, config);
  if (info.url) throw new Error("Bot đã có webhook. Dùng bot mới cho tài khoản mới; hàm này không xóa webhook đang chạy.");
  const updates = telegramApi_("getUpdates", { timeout: 0, limit: 100, allowed_updates: ["message", "callback_query"] }, config);
  const chats = {};
  updates.forEach(update => {
    const chat = update.message && update.message.chat;
    if (chat && chat.type === "private") chats[String(chat.id)] = { chatId: String(chat.id), firstName: chat.first_name || "" };
  });
  const result = Object.keys(chats).map(id => chats[id]);
  Logger.log(JSON.stringify(result, null, 2));
  if (!result.length) Logger.log("Mở đúng bot trên Telegram, nhấn Start và gửi MSB_SETUP, sau đó chạy lại. Bot chưa phản hồi lúc này là bình thường.");
  else Logger.log("Đối chiếu cuộc chat của chính bạn rồi lưu chatId vào Script Property TELEGRAM_CHAT_ID. Hàm không tự chọn người dùng.");
  return result;
}

function checkNewAccountSetup() {
  const { config, cards } = getSystemData();
  const ss = getSpreadsheet_();
  const holidays = ss.getSheetByName("Ngay_Le");
  const count = holidays ? holidays.getDataRange().getValues().slice(1).filter(row => parseDate(row[0])).length : 0;
  const report = {
    version: MSB_VERSION,
    hasOwnerName: Boolean(config.TEN_CHU_THE), hasRecipient: Boolean(config.EMAIL_CSKH_MSB),
    hasBotToken: Boolean(config.TELEGRAM_BOT_TOKEN), hasChatId: Boolean(config.TELEGRAM_CHAT_ID),
    activeCards: cards.length, locale: ss.getSpreadsheetLocale(), timezone: ss.getSpreadsheetTimeZone(),
    holidayRows: count,
    note: "Số dòng nghỉ không chứng minh lịch đầy đủ. Kiểm tra lịch năm hiện tại và năm tới trước khi bật email tự động."
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// Email thử riêng, không dùng địa chỉ CSKH và không thay trạng thái bản ghi.
function sendSetupTestEmail() {
  const to = (PropertiesService.getScriptProperties().getProperty("TEST_EMAIL") || "").trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error("Đặt TEST_EMAIL trong Script Properties bằng một địa chỉ email của bạn.");
  GmailApp.sendEmail(to, "[TEST] MSB Auto Complain — kiểm tra cài đặt", "Email này xác nhận tài khoản đã cấp quyền gửi thư. Đây là email thử, không phải khiếu nại và không thay đổi dữ liệu Sheet.");
  Logger.log("Đã gọi Gmail gửi email thử tới TEST_EMAIL. Kiểm tra Inbox/Spam và Sent; chưa tạo lịch tự động.");
}

function previewComplaintEmails() {
  const ss = getSpreadsheet_();
  const timezone = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
  const report = [];
  getTrackingSheet_().getDataRange().getValues().forEach((row, i) => {
    if (i === 0 || !row[0]) return;
    const due = parseDate(row[5]);
    const dueDay = due ? Utilities.formatDate(due, timezone, "yyyy-MM-dd") : null;
    const reason = row[6] !== "Chờ hoàn" ? `Trạng thái ${row[6]}` : !dueDay ? "Cột F chưa có ngày hợp lệ" : today <= dueDay ? "Chưa quá hạn" : "Đủ điều kiện gửi";
    report.push({ row: i + 1, id: String(row[0]), today, dueDay, eligible: reason === "Đủ điều kiện gửi", reason });
  });
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// Chỉ tạo lịch khi người cài chủ động chạy hàm, không tự chạy trong bước khởi tạo.
function installDailyEmailTrigger() {
  const report = checkNewAccountSetup();
  if (!report.hasOwnerName || !report.hasRecipient || !report.activeCards || !report.holidayRows) {
    throw new Error("Chưa đủ cấu hình: cần tên chủ thẻ, email nhận, ít nhất một thẻ và lịch ngày nghỉ.");
  }
  const existing = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === "kiemTraVaGuiEmailKhieuNai");
  if (existing.length) {
    Logger.log(`Đã có ${existing.length} trigger của tài khoản này; không tạo thêm. Nếu nhiều hơn 1, xóa bớt trong Triggers.`);
    return existing.length;
  }
  ScriptApp.newTrigger("kiemTraVaGuiEmailKhieuNai").timeBased().atHour(9).everyDays(1).inTimezone("Asia/Ho_Chi_Minh").create();
  Logger.log("Đã tạo một trigger hằng ngày trong khung 09:00–10:00 giờ Việt Nam. Kiểm tra mục Triggers.");
  return 1;
}
