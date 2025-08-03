# 📦 terabox-downloader

A CLI tool to download TeraBox videos by extracting and combining M3U8 TS segments into a single MP4 file.

---

## ⚙️ Features

- Fetches 480p M3U8 stream from a TeraBox share URL
- Downloads `.ts` segments with progress bars
- Automatically combines `.ts` segments into a final MP4 using FFmpeg
- Fully command-line — no server or GUI needed

---

## 🧱 Requirements

- [Node.js](https://nodejs.org/) (v16 or higher)
- [FFmpeg](https://ffmpeg.org/) installed and accessible from your terminal

---

## 📦 Installation (via `git clone`)

```bash
git clone https://github.com/yourusername/terabox-downloader.git
cd terabox-downloader
npm install
npm link
