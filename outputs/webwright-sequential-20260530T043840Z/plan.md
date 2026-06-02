# Critical Points
- [x] CP1: Desktop web UI loads against middleware `http://127.0.0.1:8797` and exposes the chat composer.
- [x] CP2: First message is sent and reaches a completed assistant response state before sending the second message.
- [x] CP3: Second message sent after completion also completes successfully.
- [x] CP4: The final conversation has no duplicate `data-message-id` values and includes both user messages in order.
