const { chromium } = require('playwright');
const fetch = require('node-fetch');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('C:\\ffmpeg-7.1.1-essentials_build\\bin\\ffmpeg.exe');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const fsSync = require('fs');
const fs = require('fs');     // for streams like createReadStream
const m3u8Parser = require('m3u8-parser');
const axios = require('axios');
const path = require('path');
const querystring = require('querystring');
const chalk = require('chalk');

// Log messages with color and IST timestamp
const logMessage = (message, level = 'info') => {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  if (level === 'info') {
    console.log(chalk.blue(`[ℹ ${timestamp}] ${message}`));
  } else if (level === 'success') {
    console.log(chalk.green(`[✅ ${timestamp}] ${message}`));
  } else if (level === 'error') {
    console.log(chalk.red(`[❌ ${timestamp}] ${message}`));
  } else if (level === 'progress') {
    console.log(chalk.yellow(`[➡️ ${timestamp}] ${message}`));
  }
};

// Fetch the initial M3U8 stream URL using Playwright
const fetchInitialVideoUrl = async (pageUrl) => {
  let foundUrl = null;
  logMessage('Opening browser to fetch initial stream URL...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await new Promise(async (resolve) => {
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/share/streaming') && url.includes('M3U8_SUBTITLE_SRT')) {
        const videoUrl = url.replace('M3U8_SUBTITLE_SRT', 'M3U8_FLV_264_480');
        logMessage(`Found 480p stream URL: ${videoUrl}`, 'success');
        foundUrl = videoUrl;
        resolve();
      }
    });
    try {
      await page.goto(pageUrl, { timeout: 30000 });
    } catch (error) {
      logMessage(`Failed to load page: ${error.message}`, 'error');
      resolve();
    }
  });

  await browser.close();
  return foundUrl;
};

// Parse M3U8 playlist to get segment metadata
const getSegmentMetadata = async (m3u8Url) => {
  try {
    const response = await axios.get(m3u8Url, { timeout: 10000 });
    const parser = new m3u8Parser.Parser();
    parser.push(response.data);
    parser.end();
    const playlist = parser.manifest;

    if (!playlist.segments || playlist.segments.length === 0) {
      logMessage('Empty playlist received', 'error');
      return [];
    }

    const segments = playlist.segments.map((seg, index) => {
      let url = seg.uri;
      if (!url.startsWith('http')) {
        const baseUri = m3u8Url.substring(0, m3u8Url.lastIndexOf('/'));
        url = `${baseUri}/${url}`;
      }
      const parsedUrl = new URL(url);
      const params = querystring.parse(parsedUrl.search.slice(1));
      const match = url.match(/_1138_(\d+)_ts/);
      const groupId = match ? `_1138_${match[1]}_ts` : `unknown_${index}`;
      return {
        url,
        groupId,
        duration: seg.duration || 30, // Assume 30s if not specified
        size: parseInt(params.size || 0),
        range: params.range || '0-0'
      };
    });

    return segments;
  } catch (error) {
    logMessage(`Failed to parse M3U8 playlist: ${error.message}`, 'error');
    return [];
  }
};

// Download and combine TS files from an array of URLs
async function downloadAndCombineTS(urls, outputFile, id) {
  const tsFiles = [];
  const total = urls.length;
  const progress = Array(total).fill('[__________]');

  // Print initial progress for all segments
  process.stdout.write('\n');
  for (let i = 0; i < total; i++) {
    process.stdout.write(`Segment ${i + 1}: ${progress[i]}\n`);
  }

  // Helper to update progress bar for a segment
  function updateProgress(index, percent) {
    const filled = Math.floor(percent / 10);
    const bar = `[${'='.repeat(filled)}${'_'.repeat(10 - filled)}]`;
    progress[index] = bar;
    // Move cursor up to the correct line
    process.stdout.write(`\x1b[${total - index}A`);
    process.stdout.write(`Segment ${index + 1}: ${bar} ${percent}%   \n`);
    // Move cursor back down to the bottom
    process.stdout.write(`\x1b[${total - index - 1}B`);
  }

  await Promise.all(
    urls.map(async (url, i) => {
      const inputFile = `downloaded_${i}.ts`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
        const totalSize = Number(response.headers.get('content-length')) || 0;
        let downloaded = 0;
        let lastPercent = 0;

        await new Promise((resolve, reject) => {
          const fileStream = fsSync.createWriteStream(inputFile);
          response.body.on('data', chunk => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const percent = Math.min(100, Math.floor((downloaded / totalSize) * 100));
              // Only update for every 10% increment
              if (percent - lastPercent >= 10 || percent === 100) {
                lastPercent = percent;
                updateProgress(i, percent);
              }
            }
          });
          response.body.on('end', () => {
            updateProgress(i, 100);
            resolve();
          });
          response.body.on('error', err => {
            updateProgress(i, 0);
            reject(err);
          });
          response.body.pipe(fileStream);
        });

        tsFiles[i] = inputFile;
      } catch (err) {
        updateProgress(i, 0);
        console.error(`\nError downloading segment ${i + 1}:`, err);
      }
    })
  );

  process.stdout.write(`\nAll segments downloaded (${tsFiles.filter(Boolean).length}/${total}).\n`);

  if (tsFiles.length > 0) {
    // Create concat list file
    const concatList = tsFiles.map(f => `file '${f}'`).join('\n');
    fsSync.writeFileSync('concat_list.txt', concatList);

    await new Promise((resolve, reject) => {
  ffmpeg()
    .input('concat_list.txt')
    .inputOptions(['-f', 'concat', '-safe', '0'])
    .outputOptions('-c copy')
    .on('end', () => {
      console.log(`✅ Combined video saved as ${outputFile}`);

      // Log video metadata using ffprobe
      ffmpeg.ffprobe(outputFile, (err, metadata) => {
        if (err) {
          console.error('❌ Failed to get video metadata:', err.message);
        } else {
          console.log('🎥 Video Metadata:');
          if (metadata.format) {
            console.log(`- Format: ${metadata.format.format_long_name}`);
            console.log(`- Duration: ${metadata.format.duration} seconds`);
            console.log(`- Size: ${(metadata.format.size / (1024 * 1024)).toFixed(2)} MB`);
            console.log(`- Bitrate: ${metadata.format.bit_rate} bps`);
          }

          if (metadata.streams && metadata.streams.length) {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream) {
              console.log(`- Codec: ${videoStream.codec_name}`);
              console.log(`- Width: ${videoStream.width}`);
              console.log(`- Height: ${videoStream.height}`);
              console.log(`- FPS: ${eval(videoStream.avg_frame_rate).toFixed(2)}`);
            }
          }

          // Log full metadata (optional)
          console.log('📋 Full Metadata:', JSON.stringify(metadata, null, 2));
        }

        // Cleanup
        tsFiles.forEach(f => fsSync.unlinkSync(f));
        fsSync.unlinkSync('concat_list.txt');

        resolve(); // Finish Promise
      });
    })
    .on('error', (err) => {
      console.error('❌ FFmpeg error:', err.message);
      reject(err);
    })
    .save(outputFile);
});

  } else {
    console.log('No files to combine.');
  }
}

// List segment URLs from M3U8 until each group repeats a certain number of times
const listSegmentUrlsUntilRepeat = async (m3u8Url, repeatCount = 3, maxAttempts = 1000, id) => {
  const groupCounts = {};
  let attempt = 0;
  let allGroupsReached = false;

  while (!allGroupsReached && attempt < maxAttempts) {
    attempt++;
    logMessage(`Attempt ${attempt}: Fetching segments...`, 'progress');
    const segments = await getSegmentMetadata(m3u8Url);

    if (!segments.length) {
      logMessage('No segments found in playlist.', 'error');
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }

    segments.forEach(segment => {
      if (!groupCounts[segment.groupId]) {
        groupCounts[segment.groupId] = { count: 0, url: segment.url };
      }
      groupCounts[segment.groupId].count += 1;
    });

    // Check if all groups have reached the repeat count
    allGroupsReached = Object.values(groupCounts).length > 0 &&
      Object.values(groupCounts).every(g => g.count >= repeatCount);

    // No delay if not all groups reached
  }

  logMessage(`Group repeat summary (repeatCount=${repeatCount}):`, 'success');

  // Sort groupIds by the numeric part in ascending order
  const sortedGroups = Object.entries(groupCounts).sort(([a], [b]) => {
    // Extract the number from groupId (e.g., _1138_5_ts -> 5)
    const numA = parseInt(a.match(/_1138_(\d+)_ts/)?.[1] || '0', 10);
    const numB = parseInt(b.match(/_1138_(\d+)_ts/)?.[1] || '0', 10);
    return numA - numB;
  });

  const modifiedUrls = [];
  sortedGroups.forEach(([groupId, info], idx) => {
    let originalUrl = info.url;
    let modifiedUrl = updateRangeInUrl(originalUrl);
    modifiedUrls.push(modifiedUrl);

    console.log(`[${idx + 1}] ${groupId} - seen ${info.count} times`);
    console.log(`  Original: ${originalUrl}`);
    console.log(`  Modified: ${modifiedUrl}`);
  });

  // Get filename from the first URL (or fallback)
  const outputFile = getFilenameFromUrl(modifiedUrls[0]);

  // After the loop, call the download and combine function:
  if (modifiedUrls.length > 0) {
    await downloadAndCombineTS(modifiedUrls, outputFile, id);
  }
};
// Update the range parameter in the URL to a fixed value
// This function updates the 'range' parameter in the URL to a fixed value
function updateRangeInUrl(rawUrl) {
  try {
    // Find start of query
    const [baseUrl, queryString] = rawUrl.split('?');

    if (!queryString) return rawUrl;

    const updatedQuery = queryString
      .split('&')
      .map(param => {
        if (param.startsWith('range=')) {
          return 'range=1-9999999999';
        }
        return param;
      })
      .join('&');

    return `${baseUrl}?${updatedQuery}`;
  } catch (e) {
    return '[Invalid URL]';
  }
}

// Get the output filename from the URL
function getFilenameFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const params = new URLSearchParams(parsedUrl.search);
    return params.get('fn') || 'output.mp4';
  } catch {
    return 'output.mp4';
  }
}

// Entry point
// Entry point
(async () => {
  const args = process.argv.slice(2);
  const pageUrl = args[0];
  const id = args[1] || Date.now().toString(); // fallback to timestamp

  if (!pageUrl) {
    logMessage('❌ No URL provided.', 'error');
    logMessage('Usage: node index-v1.js <terabox_video_url> [optional_id]', 'info');
    return;
  }

  logMessage(`Using URL from command: ${pageUrl} (id: ${id})`, 'info');

  try {
    const m3u8Url = await fetchInitialVideoUrl(pageUrl);
    if (!m3u8Url) {
      logMessage('Failed to fetch M3U8 URL. Please check the page URL.', 'error');
      return;
    }

    await listSegmentUrlsUntilRepeat(m3u8Url, 8, 50, id);
  } catch (error) {
    logMessage(`Script failed: ${error.message}`, 'error');
  }
})();
