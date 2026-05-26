const { gmd } = require("../guru");
const yts = require("yt-search");
const axios = require("axios");

const API_BASE = "https://apis.davidcyril.name.ng";
const API_TIMEOUT = 25000;

async function fetchAudio(query) {
    const url = `${API_BASE}/play?query=${encodeURIComponent(query)}`;
    console.log(`[play] Fetching: ${url}`);
    const res = await axios.get(url, { timeout: API_TIMEOUT });
    const d = res.data;
    if (d.status === true && d.result?.download_url) {
        return {
            download_url: d.result.download_url,
            title: d.result.title,
            duration: d.result.duration,
            thumbnail: d.result.thumbnail,
            video_url: d.result.video_url,
        };
    }
    throw new Error(d.message || "API returned no download URL");
}

gmd(
    {
        pattern: "play",
        aliases: ["ytmp3", "ytmp3doc", "audiodoc", "yta"],
        category: "downloader",
        react: "🎶",
        description: "Download Audio from YouTube",
    },
    async (from, Gifted, conText) => {
        const { q, reply, react, botPic, gmdBuffer, formatAudio } = conText;

        if (!q) {
            await react("❌");
            return reply("Please provide a song name or YouTube link.\n\nExample: *.play mambichwa*");
        }

        try {
            await react("🔍");

            let videoUrl, videoTitle, videoThumbnail, videoDuration;

            if (q.includes("youtube.com/watch") || q.includes("youtu.be/")) {
                const videoId = q.includes("youtube.com/watch")
                    ? q.split("v=")[1]?.split("&")[0]
                    : q.split("/").pop()?.split("?")[0];

                const info = await yts({ videoId });
                videoUrl = q;
                videoTitle = info.title || info.name || q;
                videoThumbnail = info.thumbnail || info.image || botPic;
                videoDuration = info.timestamp || info.duration || "Unknown";
            } else {
                const search = await yts(q);
                if (!search.videos.length) {
                    await react("❌");
                    return reply("❌ No results found for *" + q + "*. Try a different song name.");
                }
                const top = search.videos[0];
                videoUrl = top.url;
                videoTitle = top.title || q;
                videoThumbnail = top.thumbnail || top.image || botPic;
                videoDuration = top.timestamp || top.duration || "Unknown";
            }

            let apiResult;
            try {
                apiResult = await fetchAudio(videoTitle);
            } catch (err) {
                console.log(`[play] API error: ${err.message}`);
                await react("❌");
                return reply("❌ Could not fetch audio for *" + videoTitle + "*.\nPlease try again later.");
            }

            const title = apiResult.title || videoTitle;
            const duration = apiResult.duration || videoDuration;

            await react("⬇️");

            const buffer = await gmdBuffer(apiResult.download_url);

            if (!Buffer.isBuffer(buffer) || buffer.length < 0x2800) {
                await react("❌");
                return reply("❌ Failed to download audio. Please try again.");
            }

            const converted = await formatAudio(buffer);
            const safeTitle = title.replace(/[^\w\s.-]/gi, "");

            await Gifted.sendMessage(from, {
                audio: converted,
                mimetype: "audio/mpeg",
                ptt: false,
            });

            await Gifted.sendMessage(from, {
                document: converted,
                mimetype: "audio/mpeg",
                fileName: `${safeTitle}.mp3`,
                caption: `🎵 *${title}*\n⏱️ *Duration:* ${duration}`,
            });

            await react("✅");

        } catch (error) {
            console.error("[play] Unexpected error:", error.message);
            await react("❌");
            return reply("❌ Something went wrong. Please try again.\n\nError: " + error.message);
        }
    }
);
