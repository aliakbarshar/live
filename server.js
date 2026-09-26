const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve HTML Dashboard
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Supabase Connection
const SUPABASE_URL = "https://meywyyvqmrnpbzrzzhvm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let ffmpegProcess = null;

console.log("==================================================");
console.log(`🚀 Web Server & Stream Engine Running on http://localhost:${PORT}`);
console.log("📡 Waiting for Commands from Dashboard...");
console.log("==================================================");

// Realtime Command Listener
supabase
  .channel('stream_commands')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_commands' }, async (payload) => {
    const command = payload.new.command;
    console.log(`\n📩 Command Received: [ ${command.toUpperCase()} ]`);

    if (command === 'start') {
      await startBroadcaster();
    } else if (command === 'stop') {
      stopBroadcaster();
    }
  })
  .subscribe();

async function startBroadcaster() {
  if (ffmpegProcess) {
    console.log("⚠️ Stream is already running!");
    return;
  }

  const { data: config, error } = await supabase.from('stream_config').select('*').eq('id', 1).single();

  if (error || !config || !config.fb_key) {
    console.error("❌ Config or FB Stream Key missing!");
    return;
  }

  const playlist = config.playlist || [];
  if (playlist.length === 0) {
    console.error("❌ Playlist is empty!");
    return;
  }

  // Generate playlist text file for FFmpeg concat
  const listFilePath = path.join(__dirname, 'playlist.txt');
  let fileContent = '';
  playlist.forEach(item => {
    const safePath = item.url.replace(/'/g, "'\\''");
    fileContent += `file '${safePath}'\n`;
  });
  fs.writeFileSync(listFilePath, fileContent);

  const rtmpsUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${config.fb_key}`;

  // Overlays
  let filterComplex = '';
  const hasLogo = config.logo_url && config.logo_url.trim() !== '';
  const hasTicker = config.ticker_text && config.ticker_text.trim() !== '';

  if (hasLogo && hasTicker) {
    const overlayPos = config.logo_pos === 'top-left' ? 'x=20:y=20' : 'x=main_w-overlay_w-20:y=20';
    const tickerEscaped = config.ticker_text.replace(/:/g, '\\:').replace(/'/g, '');
    filterComplex = `[1:v]scale=120:-1[logo];[0:v][logo]overlay=${overlayPos}[v1];[v1]drawtext=text='${tickerEscaped}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.6:boxborderw=10:x=w-mod(max_t*100\\,w+tw):y=h-50[v]`;
  } else if (hasLogo) {
    const overlayPos = config.logo_pos === 'top-left' ? 'x=20:y=20' : 'x=main_w-overlay_w-20:y=20';
    filterComplex = `[1:v]scale=120:-1[logo];[0:v][logo]overlay=${overlayPos}[v]`;
  } else if (hasTicker) {
    const tickerEscaped = config.ticker_text.replace(/:/g, '\\:').replace(/'/g, '');
    filterComplex = `[0:v]drawtext=text='${tickerEscaped}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.6:boxborderw=10:x=w-mod(max_t*100\\,w+tw):y=h-50[v]`;
  }

  let ffmpegArgs = [
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-stream_loop', '-1',
    '-i', listFilePath
  ];

  if (hasLogo) ffmpegArgs.push('-i', config.logo_url);

  if (filterComplex !== '') {
    ffmpegArgs.push('-filter_complex', filterComplex, '-map', '[v]', '-map', '0:a?');
  } else {
    ffmpegArgs.push('-map', '0:v', '-map', '0:a?');
  }

  ffmpegArgs.push(
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p', '-g', '60',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv', rtmpsUrl
  );

  console.log("🎬 FFmpeg Live Stream Starting...");
  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    const str = data.toString();
    if (str.includes('frame=')) {
      process.stdout.write(`📡 Streaming Progress: ${str.trim()}\r`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`\n🔴 Streaming Stopped: code ${code}`);
    ffmpegProcess = null;
  });
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("✅ Broadcast Stopped.");
  }
}

app.listen(PORT);
