# MSB Auto Complain - Tự động gửi khiếu nại đòi tiền hoàn thẻ tín dụng MSB

MSB - Ngân hàng TMCP Hàng Hải Việt Nam hiện tại đã tăng thời gian trả tiền hoàn thẻ tín dụng từ **30 ngày làm việc** lên **60 ngày làm việc** tức khoảng từ **2 tháng** lên **3 tháng** với lý do là **nâng cao trải nghiệm**. Tuy nhiên, dù đã kéo dài thời gian trả tiền hoàn lên tới **3 tháng** nhưng tôi, bạn và nhiều chủ thẻ tín dụng MSB khác ở ngoài kia vẫn đang phải chủ động gửi khiếu nại tới chăm sóc khách hàng mỗi tháng để đòi quyền lợi của chúng ta. Bạn đã quá chán nản với việc phải gửi khiếu nại thủ công hàng tháng? Tôi ở đây và mang tới cho bạn **MSB Auto Complain**

**MSB Auto Complain** sẽ tính toán ngày đến hạn của các khoản tiền hoàn. Nếu quá hạn mà bạn vẫn chưa nhận được tiền hoàn thì **MSB Auto Complain** sẽ tự động gửi thẳng 1 email khiếu nại theo mẫu đã được thiết lập sẵn tới địa chỉ email CSKH cá nhân của MSB.

# Hướng dẫn thiết lập

1. Truy cập [MSB_Auto_Complain_Template](https://docs.google.com/spreadsheets/d/1fLiszkUFhzxO8KZ8zCoAm5MrN0YcofR3Yz2fC104ec0/template/preview) để clone spreadsheets về tài khoản Google của bạn.
2. Mở bảng tính `Danh_Sach_The` và thực hiện điền 4 số cuối của các dòng thẻ MSB bạn đang sử dụng.
3. Mở bảng tính `Cai_Dat` và thực hiện điền các thông tin `TEN_CHU_THE` (bắt buộc), `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` (không bắt buộc).
4. Truy cập **Extensions → App Script**.
5. Tạo một file script `Code.gs` nếu chưa được tạo sẵn và thay thế toàn bộ nội dung file này bằng file [Code.gs](Code.gs).
6. Tạo thêm một file script `Setup.gs` và dán toàn bộ nội dung file [Setup.gs](Setup.gs) vào và lưu lại.
6. Chọn hàm `initializeNewAccount` ở thanh công cụ và bấm `Run`.
7. Khi Google hỏi quyền, chọn `Review Permissions`. Cửa sổ mới hiện lên `Google hasn’t verified this app` thì nhấn `Advanced` và nhấn `Go to ... (unsafe)` và cấp các quyền được yêu cầu.
8. Kiểm tra gửi email. Truy cập vào `Setting`, mục `Script Properties` chọn `Edit script properties` và thêm một property  là `TEST_EMAIL` với value là một địa chỉ mail của bạn để test việc gửi email khiếu nại sau đó bấm `Save script properties`.
9. Quay trở lại `Setup.gs`, chọn hàm `sendSetupTestEmail` để kiểm tra việc gửi email.
10. Kiểm tra việc gửi email khiếu nại khi quá hạn. Sửa lại `EMAIL_CSKH_MSB` trong sheet `Cai_Dat` thành email của bạn để kiểm tra. Sau đó tạo một bản ghi hoàn tiền đã quá hạn trong sheet `Theo_Doi_Hoan_Tien`. Quay lại `Code.gs`, chọn hàm `kiemTraVaGuiEmailKhieuNai` và bấm `Run` rồi kiểm tra.
11. Sau khi kiểm tra thành công. Thay đổi lại `EMAIL_CSKH_MSB` về địa chỉ email CSKH thật là `CSKHCaNhan@msb.com.vn`. Quay trở lại App Script, ở `Setup.gs` chọn hàm `installDailyEmailTrigger` và bấm `Run` để cài trigger tự động kiểm tra và gửi email khiếu nại vào khung giờ 9h - 10h sáng mỗi ngày.

# Thiết lập Telegram Bot

Sau khi tạo bot ở [BotFather](https://t.me/BotFather) và lấy User ID ở [Inline Info Username](https://t.me/usinfobot) thì điền thông tin này vào `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` ở bảng tính `Cai_Dat`. Quay trở lại App Script và thực hiện Deploy theo các bước sau:

1. Trong App Script chọn `Deploy` rồi chọn `New Deployment`.
2. `Select type` chọn `Web app`, `Execute as` chọn `Me`, `Who has access` chọn `Anyone`.
3. Bấm `Deploy` và cấp các quyền được yêu cầu, copy `Web app URL` sau khi deploy xong.
4. Truy cập vào `Setting`, mục `Script Properties` chọn `Edit script properties` và thêm một property  là `WEB_APP_URL` với value là URL bạn vừa sao chép sau đó bấm `Save script properties`.
5. Quay lại `Code.gs`, lần lượt chạy 2 hàm `setTelegramWebhook` và `diagnoseTelegram`.
6. Truy cập vào bot đã tạo và test thử.

Danh sách lệnh
* `/them` Thêm khoản tiền hoàn bạn đã đổi và cần theo dõi.
* `/doi` Ghi lại giao dịch đổi điểm hoàn tiền.
* `/ds` Hiển thị các khoản đổi điểm hoàn tiền đang được theo dõi.

# Thay đổi nội dung email khiếu nại

Nội dung email khiếu nại được viết trong `Code.gs`, hàm `kiemTraVaGuiEmailKhieuNai()`, ở `const subject` và `const htmlBody` (khoảng dòng 340), bạn có thể thay đổi theo ý thích của bạn.