const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');

const SUPABASE_URL = 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = 'YOUR_SERVICE_ROLE_KEY'; // هتي سروس رول ڪي هڻو
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let currentTrackIndex = 0;
let isStreaming = false;

// 🔹 اسٽريم جي سيٽنگس Supabase مان لوڊ ڪريو ۽ چالو ڪريو
async function startStreamController() {
    const { data, error } = await supabase.from('stream_config').select('*').eq('id', 1).single();
    if (error || !data) return console.log("Config load error:", error);

    if (!data.is_live) {
        console.log("⚪ Stream is currently turned OFF in Database.");
        stopFFmpeg();
        return;
    }

    const playlist = data.playlist || [];
    if (playlist.length === 0) {
        console.log("❌ Playlist is empty!");
        return;
    }

    currentTrackIndex = data.current_track_index || 0;
    
    // جيڪڏهن انڊيڪس پلي لسٽ کان وڌي وڃي ته 0 تان وري شروع ڪريو
    if (currentTrackIndex >= playlist.length) {
        currentTrackIndex = 0;
    }

    const currentVideoUrl = playlist[currentTrackIndex].url;
    const streamKey = data.fb_key || data.yt_key;

    console.log(`▶ Playing Track ${currentTrackIndex + 1}/${playlist.length}: ${currentVideoUrl}`);

    // FFmpeg ذريعي وڊيو اسٽريم شروع ڪريو
    runFFmpeg(currentVideoUrl, streamKey, data, async () => {
        // 🔁 **سونگ ختم ٿيڻ واري منطق (Auto Next Track Loop)**
        console.log("🏁 Song finished! Moving to next track...");
        
        let nextIndex = (currentTrackIndex + 1) % playlist.length;
        const upcomingIndex = (nextIndex + 1) % playlist.length;
        const autoNextTrackText = `Track ${upcomingIndex + 1} of ${playlist.length}`;

        // Supabase ۾ نئون انڊيڪس اپڊيٽ ڪريو
        await supabase.from('stream_config').update({
            current_track_index: nextIndex,
            next_track: autoNextTrackText
        }).eq('id', 1);

        // پاڻمرادو ايندڙ وڊيو هلائڻ لاءِ فنڪشن ري-ڪال (Re-call) ڪريو
        startStreamController();
    });
}

// 🔹 FFmpeg Command Runner
function runFFmpeg(videoUrl, streamKey, config, onComplete) {
    stopFFmpeg(); // پهريان هلندڙ ڪو پروسيس هجي ته بند ڪريو

    const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;

    // FFmpeg Parameter Arguments
    const args = [
        '-re',
        '-i', videoUrl,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-b:v', '3000k',
        '-maxrate', '3000k',
        '-bufsize', '6000k',
        '-pix_fmt', 'yuv420p',
        '-g', '50',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        rtmpUrl
    ];

    ffmpegProcess = spawn('ffmpeg', args);

    ffmpegProcess.stderr.on('data', (data) => {
        // console.log(`FFmpeg: ${data}`); // Debugging لاءِ
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (onComplete) onComplete(); // وڊيو ختم ٿيڻ تي ٽريڪ مٽايو
    });
}

function stopFFmpeg() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
}

// 🔹 Realtime Database Updates (جڏهن مينوئل بٽڻ دٻايو وڃي)
supabase.channel('schema-db-changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stream_config', filter: 'id=eq.1' }, (payload) => {
        console.log("⚡ Change detected in Supabase Database...");
        startStreamController();
    })
    .subscribe();

// اسٽارٽ اپ
startStreamController();
