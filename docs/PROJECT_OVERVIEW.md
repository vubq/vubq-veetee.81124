# Tổng quan dự án Veetee

## Mục tiêu

Veetee là nền tảng trợ lý giọng nói realtime dành cho thiết bị nhúng và client mô phỏng. Trải nghiệm mục tiêu là một cuộc trò chuyện tự nhiên: thiết bị bắt đầu phản hồi nhanh, cho phép ngắt lời, giữ ngữ cảnh, gọi công cụ đúng quyền, và không buộc logic nghiệp vụ vào một nhà cung cấp AI cụ thể.

## Phạm vi giai đoạn đầu

- Bootstrap/OTA và ghép nối bằng mã sáu chữ số tương thích firmware tham chiếu.
- WebSocket trực tiếp, Opus và message state machine.
- Provider catalog/instance/credential/pipeline có thể cấu hình.
- Groq-compatible LLM streaming với key pool và failover có giới hạn.
- ASR cục bộ theo HTTP profile cấu hình được, ban đầu hướng tới PhoASR/Whisper-compatible.
- TTS cục bộ theo HTTP profile cấu hình được, ban đầu hướng tới VieNeu-compatible.
- MCP device tools với phân tách tool thường và tool chỉ dành cho người vận hành.
- Console quản trị tiếng Việt mặc định, hỗ trợ chuyển ngôn ngữ.
- Simulator trình duyệt và CLI sạch-room để test khi không có phần cứng.

## Ngoài phạm vi milestone đầu

- MQTT + UDP production gateway.
- Fleet đa tenant hoặc sharding.
- Copy giao diện, model nhân vật, audio prompt, font hoặc asset nhị phân từ source tham khảo.
- Cam kết chứng thực phần cứng bằng HMAC khi chưa có quy trình provision manufacturing key.
- Tự động flash firmware hay reboot thiết bị mà không có xác nhận rõ ràng.

## Nguyên tắc thiết kế

1. **AI-driven, không hard-code provider**: adapter đọc cấu hình đã validate; URL, key, model, timeout và mapping không nằm cố định trong source.
2. **Protocol ở biên, pipeline ở lõi**: transport/frame adapter không xâm nhập provider orchestration.
3. **Snapshot theo session**: mỗi hội thoại dùng cấu hình có revision ổn định; thay đổi áp dụng cho session mới trừ khi hot-swap được chứng minh an toàn.
4. **Tiếng Việt trước, không khóa ngôn ngữ**: locale dùng BCP 47, text chuẩn hóa NFC, prompt và UI tách khỏi logic.
5. **Bảo mật mặc định bật**: không auth-off, không token trong URL cho browser lâu dài, không log secret hay nội dung hội thoại đầy đủ.
6. **Simulator là test client hạng nhất**: cùng contract fixtures với thiết bị thật.

## Giả định vận hành tạm thời

- Một chủ sở hữu, single tenant.
- Dưới 50 QPS p99 trong năm đầu, read/write khoảng 10:1.
- Dữ liệu internal và secret-sensitive.
- Modular monolith TypeScript + realtime service Python.
- Docker Compose self-hosted trước.
- Availability mục tiêu 99.5%/tháng; RPO 24 giờ; RTO 4 giờ.
- Không lưu raw audio mặc định; transcript chỉ lưu khi operator bật rõ ràng.

Các giả định này phải được xem lại khi có tải thực tế hoặc yêu cầu đa người dùng.
