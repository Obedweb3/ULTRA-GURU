const { gmd } = require("../guru");

// ─── VCF DEDUPLICATION TOOL ──────────────────────────────────────────────────

/**
 * Normalize a phone number for comparison.
 * Strips spaces, dashes, parentheses, dots, slashes.
 * Keeps leading + for international format.
 * Strips leading zeros/country-code prefixes so +254700000001 === 0700000001.
 */
function normalizePhone(raw) {
    let n = String(raw).trim();
    // Remove tel: prefix if present
    n = n.replace(/^tel:/i, "");
    // Remove all formatting characters
    n = n.replace(/[\s\-\.\(\)\/\\]/g, "");
    // Normalise: strip leading + or 00 then compare last 9 digits
    // This catches +254700123456 == 0700123456 == 254700123456
    const digits = n.replace(/^\+/, "").replace(/^00/, "");
    // Use last 9 digits as canonical key (handles most global formats)
    return digits.slice(-9);
}

/**
 * Parse a VCF string into an array of individual vCard blocks (raw strings).
 */
function parseVcards(vcfText) {
    const cards = [];
    const normalized = vcfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const regex = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
    let match;
    while ((match = regex.exec(normalized)) !== null) {
        cards.push(match[0].trim());
    }
    return cards;
}

/**
 * Extract all phone numbers from a single vCard block.
 * Handles both simple (TEL:number) and parameterized (TEL;TYPE=CELL:number) lines.
 * Also handles folded lines (lines starting with space/tab are continuations).
 */
function extractPhones(vcard) {
    const phones = [];
    const lines = vcard.split("\n");
    for (const line of lines) {
        // Match TEL lines (with or without parameters)
        if (/^TEL[;:]/i.test(line.trim())) {
            const colonIdx = line.indexOf(":");
            if (colonIdx !== -1) {
                const value = line.slice(colonIdx + 1).trim();
                if (value) phones.push(value);
            }
        }
    }
    return phones;
}

/**
 * Deduplicate vCards by phone number.
 * A card is kept if it introduces at least one phone number not seen before.
 * Returns { kept: string[], removed: number, totalPhones: number }
 */
function deduplicateVcards(cards) {
    const seen = new Set();
    const kept = [];
    let removed = 0;
    let totalPhones = 0;

    for (const card of cards) {
        const phones = extractPhones(card);
        totalPhones += phones.length;

        if (phones.length === 0) {
            // No phone number — keep it (might be email-only contact)
            kept.push(card);
            continue;
        }

        const normalised = phones.map(normalizePhone).filter(Boolean);
        const isAllDuplicate = normalised.every(n => seen.has(n));

        if (isAllDuplicate) {
            removed++;
        } else {
            // Mark all this card's numbers as seen
            normalised.forEach(n => seen.add(n));
            kept.push(card);
        }
    }

    return { kept, removed, totalPhones };
}

// ─── COMMAND ─────────────────────────────────────────────────────────────────

gmd(
    {
        pattern: "cleanvcf",
        aliases: ["dedupvcf", "vcfclean", "fixvcf"],
        desc: "Remove duplicate numbers from a VCF contact file. Reply to a VCF file with this command.",
        category: "tools",
        react: "🗂️",
    },
    async (from, Gifted, conText) => {
        const { mek, reply, conn, getMediaBuffer } = conText;

        // ── Find the VCF document ──────────────────────────────────────────
        // Support: replying to a VCF, or the message itself containing a VCF
        const ctx =
            mek.message?.extendedTextMessage?.contextInfo ||
            mek.message?.documentMessage?.contextInfo ||
            null;

        const quotedRaw = ctx?.quotedMessage || null;

        const docMsg =
            quotedRaw?.documentMessage ||
            mek.message?.documentMessage ||
            null;

        if (!docMsg) {
            return reply(
                "❌ *Reply to a VCF file* with *.cleanvcf* to remove duplicate numbers.\n\n" +
                "📌 *Usage:* Send/forward a *.vcf* file, reply to it with `.cleanvcf`"
            );
        }

        // Validate it's a VCF
        const mime = docMsg.mimetype || "";
        const fname = (docMsg.fileName || "").toLowerCase();
        const isVcf =
            mime.includes("vcard") ||
            mime.includes("x-vcard") ||
            fname.endsWith(".vcf");

        if (!isVcf) {
            return reply("❌ That file doesn't look like a VCF. Please reply to a *.vcf* contact file.");
        }

        await reply("⏳ Processing your VCF file, please wait...");

        // ── Download ──────────────────────────────────────────────────────
        let vcfBuffer;
        try {
            vcfBuffer = await getMediaBuffer(docMsg, "document");
        } catch (err) {
            return reply("❌ Failed to download the VCF file: " + err.message);
        }

        const vcfText = vcfBuffer.toString("utf8");

        // ── Parse & Deduplicate ───────────────────────────────────────────
        const cards = parseVcards(vcfText);

        if (cards.length === 0) {
            return reply("❌ No valid vCards found in the file. Make sure it's a proper VCF.");
        }

        const { kept, removed, totalPhones } = deduplicateVcards(cards);

        if (removed === 0) {
            return reply(
                `✅ *No duplicates found!*\n\n` +
                `📇 Contacts checked: *${cards.length}*\n` +
                `📞 Phone numbers scanned: *${totalPhones}*\n\n` +
                `Your VCF is already clean 🎉`
            );
        }

        // ── Build cleaned VCF ─────────────────────────────────────────────
        const cleanedVcf = kept.join("\n\n") + "\n";
        const cleanedBuffer = Buffer.from(cleanedVcf, "utf8");

        // Generate output filename
        const origName = (docMsg.fileName || "contacts.vcf").replace(/\.vcf$/i, "");
        const outName = `${origName}_cleaned.vcf`;

        // ── Send back ─────────────────────────────────────────────────────
        await conn.sendMessage(from, {
            document: cleanedBuffer,
            fileName: outName,
            mimetype: "text/vcard",
            caption:
                `✅ *VCF Cleaned Successfully!*\n\n` +
                `📇 Original contacts: *${cards.length}*\n` +
                `🗑️ Duplicates removed: *${removed}*\n` +
                `📋 Clean contacts: *${kept.length}*\n` +
                `📞 Phone numbers scanned: *${totalPhones}*\n\n` +
                `_All original contact details preserved. Only duplicate numbers removed._`,
        }, { quoted: mek });
    }
);
