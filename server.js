const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const SUPABASE_URL = "https://meywyyvqmrnpbzrzzhvm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let ffmpegProcess = null;

console.log(`🚀 Stream Studio Engine Running on http://localhost:${PORT}`);

supabase
  .channel('stream_commands')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_commands' }, async (payload) => {
    const command = payload.new.command;
    if (command === 'start') await startBroadcaster();
    else if (command === 'stop') stopBroadcaster();
  })
  .subscribe();

async function startBroadcaster() {
  if (ffmpegProcess) stopBroadcaster();

  const { data: config } = await supabase.from('stream_config').select('*').eq('id', 1).single();

  if (!config || !config.fb_key || !config.playlist || config.playlist.length === 0) {
    console.error("❌ Config or Playlist Error!");
    return;
  }

  // Generate Playlist
  const listFilePath = path.join(__dirname, 'playlist.txt');
  let fileContent = config.playlist.map(item => `file '${item.url.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listFilePath, fileContent);

  const rtmpsUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${config.fb_key}`;

  // Advance Filters Setup (Logo, Clock, News Ticker)
  let filters = [];
  let currentStream = '[0:v]';

  // 1. Logo Processing
  const hasLogo = config.logo_url && config.logo_url.trim() !== '';
  if (hasLogo) {
    const size = config.logo_size || 120;
    let pos = 'x=main_w-overlay_w-20:y=20'; // Top Right
    if (config.logo_pos === 'top-left') pos = 'x=20:y=20';
    if (config.logo_pos === 'bottom-right') pos = 'x=main_w-overlay_w-20:y=main_h-overlay_h-70';
    if (config.logo_pos === 'bottom-left') pos = 'x=20:y=main_h-overlay_h-70';

    filters.push(`[1:v]scale=${size}:-1[logo]`);
    filters.push(`${currentStream}[logo]overlay=${pos}[v_logo]`);
    currentStream = '[v_logo]';
  }

  // 2. Live Clock Processing
  if (config.show_clock) {
    const clockFilter = `${currentStream}drawtext=text='%{localtime\\:%I\\:%M\\:%S %p}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=6:x=w-tw-20:y=h-40[v_clock]`;
    filters.push(clockFilter);
    currentStream = '[v_clock]';
  }

  // 3. Scrolling Ticker Processing
  if (config.ticker_text && config.ticker_text.trim() !== '') {
    const tickerEscaped = config.ticker_text.replace(/:/g, '\\:').replace(/'/g, '');
    const tickerFilter = `${currentStream}drawtext=text='${tickerEscaped}':fontcolor=white:fontsize=24:box=1:boxcolor=red@0.8:boxborderw=10:x=w-mod(max_t*120\\,w+tw):y=h-40[v_final]`;
    filters.push(tickerFilter);
    currentStream = '[v_final]';
  }

  let ffmpegArgs = ['-re', '-f', 'concat', '-safe', '0', '-stream_loop', '-1', '-i', listFilePath];

  if (hasLogo) ffmpegArgs.push('-i', config.logo_url);

  if (filters.length > 0) {
    ffmpegArgs.push('-filter_complex', filters.join(';'), '-map', currentStream, '-map', '0:a?');
  } else {
    ffmpegArgs.push('-map', '0:v', '-map', '0:a?');
  }

  ffmpegArgs.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k',
    '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p',
    '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv', rtmpsUrl
  );

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
  console.log("🎬 Live Broadcast Started with Custom Graphics!");
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Broadcast Stopped.");
  }
}

app.listen(PORT);
