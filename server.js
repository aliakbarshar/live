const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

// Supabase Connection setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;

console.log("🚀 Multi-Stream Cloud Engine Initializing...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    // بند ڪرڻ لاءِ
    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stopping Broadcaster...");
      stopBroadcaster();
    }
    // چالو ڪرڻ لاءِ
    else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Starting Multi-Broadcaster...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Loop Error:", err);
  }
}

function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://aliakbarshar.github.io/live/TestTrack1.mp4' }];

  const videoUrl = playlist[0].url;

  // Stream Output Targets Setup
  const outputs = [];

  if (config.fb_key && config.fb_key.trim() !== '') {
    outputs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${config.fb_key.trim()}`);
  }

  if (config.yt_key && config.yt_key.trim() !== '') {
    outputs.push(`rtmp://a.rtmp.youtube.com/live2/${config.yt_key.trim()}`);
  }

  if (outputs.length === 0) {
    console.error("❌ No valid Stream Keys found for Facebook or YouTube!");
    return;
  }

  console.log(`🎬 Streaming Video: ${videoUrl}`);
  console.log(`📡 Targets Active: ${outputs.length} Platform(s)`);

  let ffmpegArgs = [
    '-re',
    '-stream_loop', '-1',
    '-i', videoUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '3000k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100'
  ];

  // Multiple Destinations handling
  if (outputs.length === 1) {
    ffmpegArgs.push('-f', 'flv', outputs[0]);
  } else {
    // Duplicate stream for multiple platforms (Facebook + YouTube)
    ffmpegArgs.push(
      '-f', 'tee',
      `-map`, `0:v`, `-map`, `0:a`,
      `[f=flv]${outputs[0]}|[f=flv]${outputs[1]}`
    );
  }

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg]: ${data.toString()}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`🔴 FFmpeg Process Exited with code: ${code}`);
    ffmpegProcess = null;
  });
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Broadcast Terminated.");
  }
}

// Check database state every 5 seconds
setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Multi-Platform Cloud Broadcaster Active!'));
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
