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
        console.error("Failed to load stream_config from Supabase:", error);
        return;
    }

    const fbKey = config.fb_key;
    if (!fbKey) {
        console.error("Facebook Stream Key missing!");
        return;
    }

    // پلي لسٽ مان وڊيو سورس وٺو
    let videoSource = "C:\\live\\videos\\TestTrack1.mp4"; 
    if (config.playlist && config.playlist.length > 0) {
        videoSource = config.playlist[0].url; // پهريون شڊيول وڊيو
    }

    // جيڪڏهن پينل مان 'Local File: filename.mp4' لکجي آيو آهي ته ان مان پاٿ صاف ڪريو
    if (videoSource.startsWith("Local File: ")) {
        const fileName = videoSource.replace("Local File: ", "");
        videoSource = `C:\\live\\videos\\${fileName}`;
    }

    const rtmpDestination = `rtmps://live-api-s.facebook.com:443/rtmp/${fbKey}`;

    console.log(`Starting 24/7 Continuous FFmpeg stream for video: ${videoSource}`);

    // FFmpeg ڪمانڊ (24/7 Loop ۽ Facebook Standards لاءِ)
    const ffmpegArgs = [
        '-stream_loop', '-1',          // وڊيو کي مسلسل لوپ ۾ هلائڻ لاءِ
        '-re',                         // حقيقي وقت (Realtime) اسپيڊ تي هلائڻ لاءِ
        '-i', videoSource,             // وڊيو فائل پاٿ يا لنڪ
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
