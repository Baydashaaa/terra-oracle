/**
 * Oracle Draw V2 - SectorDetails
 *
 * Окно по клику на сектор: чьи NFT участвуют в раунде и сколько entries
 * они дают. Единственное место, где картинки масок уместны - здесь есть
 * куда их положить, в отличие от узкого сектора.
 *
 * Модалкасама создаёт свою разметку и берёт цвета из темы колеса, поэтому
 * ни index.html, ни style.css трогать не нужно - всё уезжает в бандл.
 */

import { rarityOf } from "../wheel/WheelTheme.js";

const ART = {
    common: "/nfts/common-md.png",
    rare: "/nfts/rare-md.png",
    legendary: "/nfts/legendary-md.png"
};

const ID = "oracle-sector-details";

export default class SectorDetails {

    constructor() {
        this.root = null;
        this.onKey = (e) => { if (e.key === "Escape") this.close(); };
    }

    /**
     * @param {object} sector сектор из TicketModel
     * @param {object} theme  тема колеса (цвета)
     * @param {object} ui     window.OracleDrawUI
     * @param {number} total  всего entries в раунде
     */
    open(sector, theme, ui, total) {
        if (!sector) return;
        this.close();

        const accent = theme.text.accent;
        const root = document.createElement("div");
        root.id = ID;
        root.innerHTML = this.#markup(sector, theme, ui, total, accent);
        document.body.appendChild(root);
        this.root = root;

        root.addEventListener("click", (e) => {
            if (e.target === root || e.target.closest("[data-close]")) this.close();
        });
        document.addEventListener("keydown", this.onKey);

        requestAnimationFrame(() => root.classList.add("is-open"));
    }

    close() {
        document.removeEventListener("keydown", this.onKey);
        const old = document.getElementById(ID);
        if (old) old.remove();
        this.root = null;
    }

    /* ---------- разметка ---------- */

    #markup(sector, theme, ui, total, accent) {
        const share = total ? (sector.entries / total) * 100 : 0;
        const fmt = ui && ui.fmt ? ui.fmt : (v) => v;

        // Групповой сектор - показываем список кошельков, а не NFT
        if (sector.isGroup) {
            const rows = (sector.members || [])
                .slice()
                .sort((a, b) => b.entries - a.entries)
                .map(m => `
                    <div class="osd-row">
                      <div class="osd-mono">${esc(short(m.address))}</div>
                      <div class="osd-dim">${m.entries} ${m.entries === 1 ? "entry" : "entries"}</div>
                    </div>`).join("");
            return this.#shell(theme, accent, `
                <div class="osd-title">${sector.members.length} wallets</div>
                <div class="osd-sub">Grouped to keep the wheel readable · ${sector.entries} entries total
                  · ${share.toFixed(1)}% chance</div>
                <div class="osd-list">${rows}</div>`);
        }

        const nfts = (ui && ui.walletNfts) ? (ui.walletNfts(sector.address) || []) : [];

        const cards = nfts.length ? nfts.map(n => {
            const r = rarityOf(n.tier);
            return `
              <div class="osd-nft" style="border-color:${r.edge}">
                <div class="osd-art" style="background:${withAlpha(r.base, 0.10)}">
                  <img src="${esc(ART[n.tier] || ART.common)}" alt=""
                       onerror="this.style.display='none'">
                </div>
                <div class="osd-nft-body">
                  <div class="osd-nft-id">${n.tokenId ? "#" + esc(n.tokenId) : "NFT"}</div>
                  <div class="osd-badge" style="color:${r.base};border-color:${r.edge}">${r.label}</div>
                  <div class="osd-dim">${n.entries} ${n.entries === 1 ? "entry" : "entries"}</div>
                </div>
              </div>`;
        }).join("") : `<div class="osd-empty">Ticket data not available for this round</div>`;

        return this.#shell(theme, accent, `
            <div class="osd-title">Sector №${sector.number}</div>
            <div class="osd-mono osd-addr">${esc(sector.address || "")}</div>
            <div class="osd-stats">
              <div><b>${sector.entries}</b><i>entries</i></div>
              <div><b>${share.toFixed(1)}%</b><i>chance</i></div>
              <div><b>${nfts.length || sector.meta.mints || 1}</b><i>NFTs</i></div>
            </div>
            <div class="osd-grid">${cards}</div>`);
    }

    #shell(theme, accent, inner) {
        return `
          <style>
            #${ID}{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
              background:rgba(3,6,14,.72);backdrop-filter:blur(6px);
              opacity:0;transition:opacity .18s ease;padding:20px}
            #${ID}.is-open{opacity:1}
            #${ID} .osd-card{width:min(520px,100%);max-height:85vh;overflow:auto;
              background:linear-gradient(180deg,#0c1220,#070b14);
              border:1px solid ${withAlpha(accent,.28)};border-radius:16px;padding:22px;
              transform:translateY(8px);transition:transform .18s ease;
              box-shadow:0 24px 70px rgba(0,0,0,.6)}
            #${ID}.is-open .osd-card{transform:none}
            #${ID} .osd-x{float:right;background:none;border:0;cursor:pointer;
              color:${withAlpha(accent,.65)};font-size:22px;line-height:1;padding:0 2px}
            #${ID} .osd-x:hover{color:${accent}}
            #${ID} .osd-title{font:800 19px ui-sans-serif,system-ui;color:${accent};margin-bottom:6px}
            #${ID} .osd-sub{font-size:12px;color:#8d99b3;margin-bottom:14px}
            #${ID} .osd-mono{font:12px ui-monospace,monospace;color:#e8ecf5;word-break:break-all}
            #${ID} .osd-addr{margin-bottom:14px}
            #${ID} .osd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
            #${ID} .osd-stats>div{background:rgba(255,255,255,.03);border:1px solid ${withAlpha(accent,.15)};
              border-radius:10px;padding:9px 6px;text-align:center}
            #${ID} .osd-stats b{display:block;font-size:17px;color:${accent}}
            #${ID} .osd-stats i{font-style:normal;font-size:9px;letter-spacing:.1em;
              text-transform:uppercase;color:#8d99b3}
            #${ID} .osd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
            #${ID} .osd-nft{display:flex;gap:10px;align-items:center;padding:9px;
              border:1px solid;border-radius:12px;background:rgba(255,255,255,.02)}
            #${ID} .osd-art{width:46px;height:46px;border-radius:9px;flex:0 0 46px;
              display:grid;place-items:center;overflow:hidden}
            #${ID} .osd-art img{width:100%;height:100%;object-fit:contain}
            #${ID} .osd-nft-id{font:700 14px ui-sans-serif,system-ui;color:#eef2fa}
            #${ID} .osd-badge{display:inline-block;font:600 9px ui-sans-serif,system-ui;
              letter-spacing:.09em;border:1px solid;border-radius:20px;padding:1px 7px;margin:3px 0}
            #${ID} .osd-dim{font-size:11px;color:#8d99b3}
            #${ID} .osd-list{display:grid;gap:6px}
            #${ID} .osd-row{display:flex;justify-content:space-between;gap:12px;
              padding:8px 10px;border:1px solid rgba(255,255,255,.06);border-radius:9px}
            #${ID} .osd-empty{font-size:12px;color:#8d99b3;padding:14px 0}
            @media (max-width:520px){#${ID} .osd-grid{grid-template-columns:1fr}}
          </style>
          <div class="osd-card">
            <button class="osd-x" data-close aria-label="Close">×</button>
            ${inner}
          </div>`;
    }
}

/* ---------- helpers ---------- */

function short(a) {
    return a && a.length > 16 ? a.slice(0, 10) + "…" + a.slice(-6) : (a || "");
}

function esc(v) {
    return String(v).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function withAlpha(hex, alpha) {
    const h = String(hex).replace("#", "");
    if (h.length < 3) return `rgba(255,255,255,${alpha})`;
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export { ART };
