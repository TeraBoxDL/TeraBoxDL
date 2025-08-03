# 📦 terabox-downloader

A CLI tool to download TeraBox videos by extracting and combining M3U8 TS segments into a single MP4 file.

---

## ⚙️ Features

- Fetches 480p M3U8 stream from a TeraBox share URL
- Downloads `.ts` segments with progress bars
- Automatically combines `.ts` segments into a final MP4 using FFmpeg
- No server dependency; fully command-line

---

## 🧱 Requirements

- [Node.js](https://nodejs.org/) (v16 or higher)
- [FFmpeg](https://ffmpeg.org/) installed and accessible (or configured in script)

---

## 📦 Installation

### From npm (after publishing):

```bash
npm install -g terabox-downloader
🚀 Usage
bash
Copy
Edit
terabox-downloader <terabox_video_url> [optional_id]
<terabox_video_url>: The full TeraBox share link

[optional_id]: Optional identifier for tracking or naming

Example:
bash
Copy
Edit
terabox-downloader https://www.terabox.com/s/1abcXYZdefGh
📁 Output
Segments are downloaded in the current directory

Combined video is saved as output.mp4 (or name extracted from URL)
