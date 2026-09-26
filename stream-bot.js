const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');

const SUPABASE_URL = "https://meywyyvqmrnpbzrzzhvm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let ffmpegProcess = null;

// Supabase مان نئين ڪمانڊ (Start / Stop) ٻڌڻ لاءِ Live Listener
supabase
  .channel('stream_commands')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_commands' }, payload => {
      const cmd = payload.new.command;
      console.log(`[COMMAND RECEIVED]: ${cmd}`);
      if (cmd === 'start') {
          startBroadcaster();
      } else if (cmd === 'stop') {
          stopBroadcaster();
      }
  })
  .subscribe();

async function startBroadcaster() {
    stopBroadcaster(); // اڳ ۾ هلندڙ اسٽريم بند ڪريو

    // Supabase مان سيٽنگز کڻو
    const { data: config, error } = await supabase.from('stream_config').select('*').eq('id', 1).single();
    if (error || !config) {
        console.error("Failed to load stream_config from Supabase.");
        return;
    }

    const fbKey = config.fb_key;
    if (!fbKey) {
        console.error("Facebook Stream Key missing!");
        return;
    }

    // پلي لسٽ مان وڊيو سورس وٺو (جيڪڏهن متبادل نه هجي ته ڊيفالٽ هلائيندو)
    let videoSource = "sample.mp4"; 
    if (config.playlist && config.playlist.length > 0) {
        videoSource = config.playlist[0].url; // پهريون شڊيول وڊيو
    }

    const rtmpDestination = `rtmps://live-api-s.facebook.com:443/rtmp/${fbKey}`;

    console.log(`Starting FFmpeg stream for video: ${videoSource}`);

    // FFmpeg ڪمانڊ (فيس بوڪ جي معيار مطابق)
    const ffmpegArgs = [
        '-re',
        '-i', videoSource,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-b:v', '3000k',
        '-maxrate', '3000k',
        '-bufsize', '6000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        rtmpDestination
    ];

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stdout.on('data', data => console.log(`FFmpeg stdout: ${data}`));
    ffmpegProcess.stderr.on('data', data => console.error(`FFmpeg Log: ${data}`));
    ffmpegProcess.on('close', code => console.log(`FFmpeg process exited with code ${code}`));
}

function stopBroadcaster() {
    if (ffmpegProcess) {
        console.log("Stopping active stream...");
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
}

console.log("Stream Studio Pro Runner Started. Waiting for commands...");
