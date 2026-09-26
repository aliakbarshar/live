const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Connection setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastIsLiveState = false;

console.log("🚀 Stream Studio Cloud Engine Initializing...");

async function checkAndStream() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) {
      console.error("❌ Supabase Fetch Error:", error);
      return;
    }

    // جيڪڏهن پينل تان Start دٻايو ويو آهي ۽ FFmpeg ناهي هلي رهيو
    if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Starting Stream...");
      startBroadcaster(config);
    } 
    // جيڪڏهن پينل تان Stop دٻايو ويو آهي
    else if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stopping Stream...");
      stopBroadcaster();
    }
  } catch (err) {
    console.error("❌ Server Loop Error:", err);
  }
}

function startBroadcaster(config) {
  if (!config.fb_key) {
    console.error("❌ Stream Key Missing!");
    return;
  }

  const videoUrl = (config.playlist && config.playlist.length > 0) 
    ? config.playlist[0].url 
    : 'https://aliakbarshar.github.io/live/TestTrack1.mp4';

  const rtmpsUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${config.fb_key.trim()}`;

  console.log(`🎬 Broadcasting Video: ${videoUrl}`);

  let ffmpegArgs = [
    '-re',
    '-stream_loop', '-1',
    '-i', videoUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2500k',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    rtmpsUrl
  ];

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg]: ${data.toString()}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`🔴 FFmpeg Stopped with code: ${code}`);
    ffmpegProcess = null;
  });
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Stream force killed.");
  }
}

// هر 5 سيڪنڊن بعد Supabase مان اسٽيٽس چيڪ ڪريو (سڀ کان مضبوط طريقو)
setInterval(checkAndStream, 5000);

app.get('/', (req, res) => res.send('Stream Studio Cloud Server is Running 24/7!'));
app.listen(PORT, () => console.log(`🌐 Server active on port ${PORT}`));
