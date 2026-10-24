// The panels of buying and carrying, drawn as the things they are in a Japanese town rather than as windows:
//  - 持ち物 (belongings): a sheet of washi with your two hands — each finger lit in the colour of what it holds — and
//    your bags as canvas grids, things dragged between them (R or a right click turns one while it is dragged)
//  - お品書き: a restaurant's wooden board of hanging paper strips, written top to bottom, under the shop's noren
//  - a café's menu card, a sweet shop's or bakery's glass case with tent cards, a shop's paper price tags
//  - a shelf of a konbini or a pharmacy: the goods standing on it over their shelf-edge price labels (taken unpaid)
//  - the till: what you carry unpaid on a thermal receipt, a bag offered, the change counted out
//  - a vending machine: its window of dummy cans over lit buttons, the coin display, the slot the can drops into, and
//    the recycling box beside it
//  - your farm (home.js): a rack of seed packets by the plot you sow, and the farm's cork board of plots and upgrades
// The HUD keeps the purse and a small pair of hands (fingers in use) under the clock.
import { ITEMS, MENUS, inv, yen, effectOf, isDrink, onInventory, handsFit, fingersOf, fingersUsed, bagsOf, sizeOf, cellsFree, whereIs,
  toHands, toBag, use, discard, buy, take, putBack, unpaid, unpaidTotal, payAll, binEmpties, empties, boostLeft, canCarry, why } from './items.js';
import { iconSVG } from './icons.js';
import { toastMsg } from './ui.js';

const css = `
.wlP { --paper: #f3eee2; --paper2: #e6dcc6; --ink: #2b2420; --ink2: #6b6153; --shu: #b8322a; --ai: #24344d; --kin: #c99a3e;
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.985); opacity: 0; pointer-events: none; z-index: 20;
  transition: opacity .16s ease, transform .16s ease; color: var(--ink); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; max-height: 92vh; }
.wlP.on { opacity: 1; transform: translate(-50%, -50%); pointer-events: auto; }
.wlP .jp { font-family: var(--mincho); }
.wlP button { all: unset; cursor: pointer; box-sizing: border-box; }
.wlP .key { display: inline-block; min-width: 18px; padding: 0 5px; border: 1px solid currentColor; border-radius: 4px; font-size: 10px; line-height: 16px; text-align: center; opacity: .8; margin: 0 2px; }
.wlP .hint { font-size: 11px; letter-spacing: .04em; opacity: .7; margin-top: 10px; text-align: center; }

/* ---- the seed rack: paper packets on a wooden stand */
.wlP.seeds { width: min(1040px, 96vw); padding: 18px 22px 14px; border-radius: 6px; background: linear-gradient(180deg, #6a4a30, #4e3522); box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 3px #3a2618; color: #f6ead2; }
.wlP.seeds header h2 { margin: 0; font: 600 26px var(--mincho); letter-spacing: .16em; } .wlP.seeds header .en { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; opacity: .75; padding-bottom: 3px; }
.wlP.seeds .pk { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px 12px; padding: 14px 10px 16px; background: repeating-linear-gradient(180deg, transparent 0 196px, #3a2618 196px 204px); }
.wlP.seeds .pkt { position: relative; cursor: pointer; padding: 26px 8px 8px; border-radius: 2px 2px 4px 4px; background: linear-gradient(180deg, #fbf6e8, #efe4c8); color: var(--ink); text-align: center; box-shadow: 0 6px 12px rgba(0,0,0,.35); transition: transform .1s; }
.wlP.seeds .pkt:hover { transform: translateY(-3px) rotate(-.6deg); }
.wlP.seeds .pkt::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 18px; background: var(--band); border-radius: 2px 2px 0 0; }
.wlP.seeds .pkt::after { content: ''; position: absolute; left: 0; right: 0; top: 18px; height: 3px; background: repeating-linear-gradient(90deg, rgba(0,0,0,.25) 0 3px, transparent 3px 6px); }
.wlP.seeds .pkt .jpn { position: absolute; top: 1px; left: 0; right: 0; font: 600 12px var(--mincho); letter-spacing: .2em; color: #fff; }
.wlP.seeds .pkt svg { width: 74px; height: 74px; display: block; margin: 2px auto 2px; }
.wlP.seeds .pkt b { display: block; font-size: 14px; } .wlP.seeds .pkt small { display: block; font-size: 11px; color: var(--ink2); }
.wlP.seeds .pkt i { position: absolute; right: -6px; bottom: -8px; font: 700 13px "Segoe UI"; font-style: normal; background: #fff3a8; color: #3a2a10; padding: 2px 7px; border-radius: 2px; transform: rotate(4deg); box-shadow: 0 2px 4px rgba(0,0,0,.3); }
.wlP.seeds .pkt.dis { opacity: .45; cursor: default; } .wlP.seeds .pkt.dis:hover { transform: none; }
.wlP.seeds .wlBar, .wlP.farm .wlBar { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 12px; } .wlP.seeds .wlBar .purse, .wlP.farm .wlBar .purse { margin: 0; font-size: 15px; }
/* ---- the farm's cork board */
.wlP.farm { width: min(860px, 96vw); padding: 20px 24px 14px; border-radius: 6px; border: 12px solid #5a3a22; color: var(--ink);
  background: radial-gradient(circle at 30% 40%, rgba(80,50,20,.25) 0 1px, transparent 1.5px) 0 0 / 6px 7px, radial-gradient(circle at 70% 20%, rgba(255,240,200,.18) 0 1px, transparent 1.5px) 0 0 / 9px 5px, #b98a58; box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 18px rgba(0,0,0,.35); }
.wlP.farm .top { display: flex; gap: 18px; align-items: stretch; }
.wlP.farm .note { position: relative; background: #fbf7ea; padding: 14px 16px 12px; box-shadow: 0 5px 10px rgba(0,0,0,.3); }
.wlP.farm .note::before { content: ''; position: absolute; top: -6px; left: 50%; width: 13px; height: 13px; margin-left: -6px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #ff8a7a, #b8322a 60%, #6a1a14); box-shadow: 1px 2px 2px rgba(0,0,0,.45); }
.wlP.farm .title { transform: rotate(-1.2deg); min-width: 240px; } .wlP.farm .title h2 { margin: 0; font: 700 30px var(--mincho); letter-spacing: .14em; } .wlP.farm .title .en { font-size: 11px; letter-spacing: .32em; color: var(--ink2); }
.wlP.farm .stats { flex: 1; transform: rotate(.8deg); display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; align-content: center; background: repeating-linear-gradient(180deg, #fbf7ea 0 22px, #d9e3ef 22px 23px); }
.wlP.farm .stats div { display: flex; justify-content: space-between; font-size: 13px; } .wlP.farm .stats b { font-size: 15px; }
.wlP.farm .acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 18px; }
.wlP.farm .act { cursor: pointer; text-align: center; transition: transform .1s; } .wlP.farm .act:nth-child(2) { transform: rotate(-1deg); } .wlP.farm .act:nth-child(3) { transform: rotate(1.3deg); }
.wlP.farm .act:hover { transform: translateY(-3px); }
.wlP.farm .act h4 { margin: 2px 0; font: 600 17px var(--mincho); letter-spacing: .08em; } .wlP.farm .act small { display: block; color: var(--ink2); font-size: 11px; min-height: 30px; }
.wlP.farm .act .pr { display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 3px; background: #24344d; color: #fff; font-weight: 700; }
.wlP.farm .act.dis { opacity: .55; cursor: default; } .wlP.farm .act.done { cursor: default; } .wlP.farm .act.done .pr { background: #8a8a80; }
.wlP.farm .act .stamp { position: absolute; right: 8px; top: 8px; width: 40px; height: 40px; border: 2.5px solid var(--shu); border-radius: 50%; color: var(--shu); font: 700 20px/36px var(--mincho); transform: rotate(-14deg); opacity: .85; }
.wlP.farm .hint { color: #3a2614; opacity: .85; }

/* ---- washi: the belongings sheet */
.wlP.bag { width: min(980px, 96vw); padding: 22px 26px 16px; border-radius: 3px;
  background: radial-gradient(circle at 20% 30%, rgba(160,130,90,.07) 0 1px, transparent 1px) 0 0 / 7px 9px,
    radial-gradient(circle at 70% 60%, rgba(160,130,90,.06) 0 1px, transparent 1px) 0 0 / 11px 7px,
    linear-gradient(180deg, #f6f1e6, #ece4d2); box-shadow: 0 30px 80px rgba(0,0,0,.55), inset 0 0 0 1px rgba(90,70,40,.18); overflow: auto; }
.wlP.bag::before { content: ''; position: absolute; inset: 7px; border: 1px solid rgba(90,70,40,.16); pointer-events: none; }
.wlP header { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 14px; }
.wlP.bag h2 { margin: 0; font: 600 30px/1 var(--mincho); letter-spacing: .12em; }
.wlP.bag header .en { font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: var(--ink2); padding-bottom: 4px; }
.purse { margin-left: auto; display: flex; align-items: center; gap: 10px; padding: 6px 14px 6px 10px; border-radius: 22px; background: #3b2a22; color: #f6e7c4; font-size: 17px; letter-spacing: .06em; box-shadow: inset 0 -2px 0 rgba(0,0,0,.3); }
.purse svg { width: 26px; height: 22px; }
.wlP .cols { display: grid; grid-template-columns: 300px 1fr; gap: 22px; align-items: start; }
.hands { position: relative; padding: 12px 12px 10px; border-radius: 4px; background: rgba(255,255,255,.45); box-shadow: inset 0 0 0 1px rgba(90,70,40,.15); }
.hands .ttl, .bagbox .ttl { display: flex; justify-content: space-between; align-items: baseline; font: 600 15px var(--mincho); letter-spacing: .1em; margin-bottom: 6px; }
.hands .ttl small, .bagbox .ttl small { font: 11px "Segoe UI", sans-serif; letter-spacing: .08em; color: var(--ink2); }
.hands svg.hh { display: block; width: 100%; height: 150px; }
.hands .finger { transition: fill .25s; }
.held { display: flex; flex-direction: column; gap: 6px; min-height: 40px; margin-top: 4px; }
.held.drop { outline: 2px dashed var(--kin); outline-offset: 4px; }
.chip { display: grid; grid-template-columns: 40px 1fr auto; gap: 8px; align-items: center; padding: 4px 8px 4px 4px; border-radius: 4px; background: #fffaf0; box-shadow: 0 1px 0 rgba(90,70,40,.25), inset 3px 0 0 var(--c); cursor: grab; }
.chip:hover, .chip.sel { box-shadow: 0 1px 0 rgba(90,70,40,.25), inset 3px 0 0 var(--c), 0 0 0 1.5px var(--c); }
.chip .ic { width: 40px; height: 40px; display: grid; place-items: center; } .chip .ic svg { max-width: 38px; max-height: 38px; width: auto; height: auto; }
.chip .nm { font-size: 12px; line-height: 1.2; } .chip .nm small { display: block; color: var(--ink2); font-family: var(--mincho); font-size: 11px; }
.chip .ff { font: 600 12px var(--mincho); color: var(--c); white-space: nowrap; }
.unpaid { position: absolute; right: -4px; top: -6px; width: 18px; height: 18px; border-radius: 50%; background: var(--shu); color: #fff; font: 700 11px/18px var(--mincho); text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
.chip { position: relative; }
.bags { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.bagbox { min-width: 214px; padding: 10px 12px 12px; border-radius: 10px 10px 6px 6px; position: relative; color: #f3eee2;
  background: repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 2px, transparent 2px 5px), var(--bc, #2f4a63); box-shadow: 0 6px 14px rgba(0,0,0,.25), inset 0 0 0 1px rgba(0,0,0,.25); }
.bagbox::before { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(240,215,160,.55); border-radius: 7px 7px 4px 4px; pointer-events: none; }
.bagbox .ttl small { color: rgba(243,238,226,.7); }
.bagbox.plastic { --bc: #e9ecec; color: var(--ink); background: linear-gradient(180deg, #f7f9f9, #e2e7e8); }
.bagbox.plastic::before { border-color: rgba(120,130,135,.35); } .bagbox.plastic .ttl small { color: var(--ink2); }
.bagbox.empty { opacity: .9; }
.grid { position: relative; background-image: linear-gradient(rgba(255,255,255,.13) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.13) 1px, transparent 1px);
  background-size: var(--cs) var(--cs); border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
.bagbox.plastic .grid { background-image: linear-gradient(rgba(0,0,0,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.08) 1px, transparent 1px); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.tile { position: absolute; border-radius: 4px; background: rgba(255,250,240,.93); box-shadow: 0 1px 0 rgba(0,0,0,.35), inset 0 0 0 1px rgba(90,70,40,.3); display: grid; place-items: center; cursor: grab; overflow: hidden; }
.tile:hover, .tile.sel { box-shadow: 0 0 0 2px var(--kin), 0 2px 6px rgba(0,0,0,.35); z-index: 2; }
.tile svg { width: calc(100% - 6px); height: calc(100% - 6px); }
.tile.rot svg { width: var(--th); height: var(--tw); transform: rotate(90deg); }
.tile .unpaid { right: 2px; top: 2px; width: 14px; height: 14px; font-size: 9px; line-height: 14px; }
.ghost { position: fixed; z-index: 40; pointer-events: none; opacity: .85; transform: rotate(-2deg); }
.ghostcell { position: absolute; background: rgba(120,220,140,.35); border-radius: 3px; pointer-events: none; z-index: 3; box-shadow: inset 0 0 0 1.5px rgba(120,220,140,.9); }
.ghostcell.bad { background: rgba(230,90,80,.3); box-shadow: inset 0 0 0 1.5px rgba(230,90,80,.9); }
.nobag { padding: 26px 18px; border-radius: 6px; color: var(--ink2); border: 1.5px dashed rgba(90,70,40,.3); font-size: 12px; max-width: 360px; line-height: 1.5; }
.nobag b { color: var(--ink); font-family: var(--mincho); font-size: 14px; display: block; margin-bottom: 4px; }
.foot { display: grid; grid-template-columns: 1fr auto; gap: 18px; margin-top: 16px; align-items: stretch; }
.card { display: grid; grid-template-columns: 76px 1fr; gap: 14px; padding: 10px 14px; min-height: 92px; border-radius: 4px; background: #fffaf0; box-shadow: 0 1px 0 rgba(90,70,40,.25), inset 0 0 0 1px rgba(90,70,40,.12); }
.card .big { display: grid; place-items: center; } .card .big svg { max-width: 72px; max-height: 76px; width: auto; height: auto; }
.card h4 { margin: 0; font-size: 16px; font-weight: 600; } .card h4 small { font: 13px var(--mincho); color: var(--ink2); margin-left: 8px; }
.card .facts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 4px 0 8px; font-size: 12px; color: var(--ink2); }
.card .facts b { color: var(--ink); font-weight: 600; }
.card .acts { display: flex; gap: 8px; flex-wrap: wrap; }
.wlP .btn { padding: 5px 14px; border-radius: 3px; background: var(--ink); color: var(--paper); font-size: 12px; letter-spacing: .08em; }
.wlP .btn:hover { background: var(--shu); } .btn.ghostb { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px rgba(43,36,32,.45); } .btn.ghostb:hover { box-shadow: inset 0 0 0 1.5px var(--shu); color: var(--shu); }
.wlP .btn[disabled] { opacity: .35; pointer-events: none; }
.card.none { grid-template-columns: 1fr; place-items: center; color: var(--ink2); font-size: 12px; text-align: center; }
.stamp { width: 132px; display: grid; place-items: center; text-align: center; }
.stamp .seal { width: 84px; height: 84px; border-radius: 50%; border: 3px solid var(--shu); color: var(--shu); display: grid; place-items: center; font: 700 26px/1 var(--mincho); transform: rotate(-8deg);
  box-shadow: inset 0 0 0 3px #f3eee2, inset 0 0 0 4.5px var(--shu); opacity: .88; letter-spacing: .05em; }
.stamp small { font-size: 11px; color: var(--ink2); margin-top: 6px; display: block; }
.stamp.off .seal { border-color: rgba(43,36,32,.18); color: rgba(43,36,32,.25); box-shadow: inset 0 0 0 3px #f3eee2, inset 0 0 0 4.5px rgba(43,36,32,.12); }

/* ---- お品書き: wooden board with hanging paper strips */
.wlP.board { width: min(900px, 96vw); padding: 0 0 18px; border-radius: 4px; overflow: hidden;
  background: repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 2px, transparent 2px 9px), repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 23px), linear-gradient(180deg, #5b3b26, #47301f);
  box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 4px #2e1d12, inset 0 0 0 6px #6f4a30; color: #f3e6cc; }
.noren { position: relative; display: flex; justify-content: center; gap: 4px; padding: 0 30px; height: 92px; background: linear-gradient(180deg, #1d1712 0 10px, transparent 10px); }
.noren span { flex: 1; max-width: 120px; height: 86px; margin-top: 6px; background: var(--nc, #1f2a44); border-radius: 0 0 3px 3px; display: grid; place-items: center; color: #f6efe0; font: 700 34px/1 var(--mincho);
  box-shadow: inset 0 -6px 0 rgba(0,0,0,.18), 0 3px 6px rgba(0,0,0,.35); }
.wlP.board .who { display: flex; align-items: center; gap: 12px; margin: 12px 30px 4px; }
.bubble { position: relative; padding: 7px 14px; border-radius: 16px; background: #fbf6ea; color: var(--ink); font: 600 15px var(--mincho); }
.bubble::before { content: ''; position: absolute; left: -7px; top: 50%; margin-top: -6px; border: 6px solid transparent; border-right-color: #fbf6ea; border-left: 0; }
.wlP .who .lbl { font-size: 11px; letter-spacing: .28em; text-transform: uppercase; opacity: .7; margin-left: auto; }
.strips { display: flex; justify-content: center; gap: 14px; padding: 18px 30px 6px; flex-wrap: wrap; }
.strip { position: relative; width: 74px; padding: 16px 0 10px; background: linear-gradient(180deg, #fbf6e8, #efe6cf); color: var(--ink); text-align: center; border-radius: 1px;
  box-shadow: 0 6px 10px rgba(0,0,0,.35); transform-origin: 50% -10px; transition: transform .18s ease, box-shadow .18s; cursor: pointer; }
.strip::before { content: ''; position: absolute; top: -9px; left: 50%; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: #c9a46a; box-shadow: 0 0 0 2px #3a2516; }
.strip:nth-child(odd) { transform: rotate(-1.2deg); } .strip:nth-child(even) { transform: rotate(1deg); }
.strip:hover { transform: rotate(0) translateY(-4px); box-shadow: 0 12px 18px rgba(0,0,0,.4); }
.strip .v { writing-mode: vertical-rl; font: 700 21px/1.1 var(--mincho); letter-spacing: .12em; height: 200px; margin: 0 auto; display: inline-block; text-align: start; }
.strip .pr { display: block; margin-top: 8px; font: 700 14px var(--mincho); color: var(--shu); }
.strip .ill { height: 46px; display: grid; place-items: center; margin: -4px 0 4px; } .strip .ill svg { max-height: 44px; max-width: 60px; width: auto; height: auto; }
.strip .en { position: absolute; left: -10px; right: -10px; bottom: -32px; font-size: 10.5px; line-height: 1.15; color: #f3e6cc; opacity: .85; }
.strip.dis { filter: grayscale(.6); opacity: .55; }
.wlP.board .wlBar { display: flex; align-items: center; justify-content: space-between; margin: 40px 30px 0; font-size: 12px; }
.wlP.board .wlBar .purse { margin: 0; font-size: 15px; }

/* ---- café menu card */
.wlP.cardm { width: min(560px, 94vw); padding: 30px 40px 22px; border-radius: 2px; background: linear-gradient(180deg, #fbf5e8, #f1e6cf); box-shadow: 0 30px 80px rgba(0,0,0,.55), inset 0 0 0 10px #fbf5e8, inset 0 0 0 11px #8a6a48, inset 0 0 0 14px #fbf5e8, inset 0 0 0 15px #8a6a48; color: #3b2a1f; }
.wlP.cardm h2 { margin: 0; text-align: center; font: italic 600 30px Georgia, serif; letter-spacing: .06em; color: #5a3a24; }
.wlP.cardm .wlSubt { text-align: center; font: 13px var(--mincho); letter-spacing: .4em; color: #8a6a48; margin: 2px 0 6px; }
.wlP.cardm .greet { text-align: center; font: 13px var(--mincho); color: #8a6a48; margin-bottom: 14px; }
.mrow { display: grid; grid-template-columns: 56px auto 1fr auto; gap: 12px; align-items: center; padding: 8px 6px; border-radius: 4px; cursor: pointer; }
.mrow:hover { background: rgba(138,106,72,.12); }
.mrow .ic svg { max-width: 52px; max-height: 50px; width: auto; height: auto; } .mrow .nm { font: 600 16px Georgia, serif; } .mrow .nm small { display: block; font: 12px var(--mincho); color: #8a6a48; }
.mrow .dots { border-bottom: 2px dotted rgba(90,58,36,.35); transform: translateY(5px); } .mrow .pr { font: 600 15px Georgia, serif; }
.mrow.dis { opacity: .45; pointer-events: none; }
.wlP.cardm .wlBar { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 12px; color: #8a6a48; } .wlP.cardm .wlBar .purse { margin: 0; font-size: 15px; }

/* ---- glass case (sweets, bakery) and price tags (cycle shop) */
.wlP.case { width: min(840px, 96vw); padding: 18px 24px 16px; border-radius: 6px; background: linear-gradient(180deg, #3a2a20, #2a1e17); box-shadow: 0 30px 80px rgba(0,0,0,.6); color: #f3e6cc; }
.wlP.case h2 { margin: 0; font: 600 24px var(--mincho); letter-spacing: .14em; } .wlP.case header .en { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; opacity: .7; padding-bottom: 3px; }
.glass { position: relative; display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; padding: 26px 20px 18px; border-radius: 4px;
  background: linear-gradient(180deg, rgba(220,240,250,.16), rgba(220,240,250,.05) 40%, rgba(255,255,255,.02)), linear-gradient(180deg, #f6efe0 0, #efe4cc 100%);
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.35), inset 0 -10px 0 #d9c9a6, 0 0 0 6px #6b4a32; }
.glass::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 40%; background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.25) 24%, transparent 30%, transparent 60%, rgba(255,255,255,.18) 63%, transparent 66%); pointer-events: none; }
.tray { width: 128px; display: flex; flex-direction: column; align-items: center; cursor: pointer; color: var(--ink); }
.tray .dish { width: 116px; height: 86px; display: grid; place-items: center; border-radius: 50%/38%; background: radial-gradient(ellipse at 50% 60%, #fff 0 55%, #e3dccd 56% 60%, transparent 61%); transition: transform .15s; }
.tray:hover .dish { transform: translateY(-3px); } .tray .dish svg { max-height: 64px; max-width: 86px; width: auto; height: auto; }
.tent { margin-top: 4px; padding: 5px 10px 6px; background: #fff; border-radius: 2px; box-shadow: 0 2px 3px rgba(0,0,0,.25); text-align: center; min-width: 96px; }
.tent b { display: block; font: 700 14px var(--mincho); } .tent small { display: block; font-size: 10.5px; color: var(--ink2); } .tent i { font-style: normal; font: 700 14px var(--mincho); color: var(--shu); }
.tray.dis { opacity: .45; pointer-events: none; }
.wlP.case .wlBar { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 12px; } .wlP.case .wlBar .purse { margin: 0; font-size: 15px; }

/* ---- a shelf: goods on it over their shelf-edge labels */
.wlP.shelf { width: min(900px, 96vw); padding: 16px 20px 14px; border-radius: 6px; background: #eef1f2; box-shadow: 0 30px 80px rgba(0,0,0,.55); color: var(--ink); }
.wlP.shelf h2 { margin: 0; font: 600 22px var(--mincho); letter-spacing: .1em; } .wlP.shelf header .en { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: var(--ink2); padding-bottom: 3px; }
.wlP.shelf.fridge { background: linear-gradient(180deg, #dfe9ee, #cfdde4); }
.rack { display: flex; flex-direction: column; gap: 0; padding: 10px 14px 4px; border-radius: 4px; background: linear-gradient(180deg, #fafbfb, #e8ecee); box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.wlP.shelf.fridge .rack { background: linear-gradient(180deg, rgba(255,255,255,.85), rgba(225,238,245,.85)); box-shadow: inset 0 0 0 3px #b9c6cc, inset 0 0 18px rgba(130,190,230,.35); }
.tier { display: flex; align-items: flex-end; justify-content: center; gap: 16px; padding-top: 8px; }
.tier + .edge { margin-bottom: 8px; }
.edge { display: flex; justify-content: center; gap: 16px; padding: 4px 0 2px; background: linear-gradient(180deg, #fdfdfd, #dfe3e5); border-top: 3px solid #c7cdd1; box-shadow: 0 2px 2px rgba(0,0,0,.08); }
.good { width: 92px; display: grid; place-items: end center; cursor: pointer; transition: transform .15s; position: relative; }
.good:hover { transform: translateY(-4px); } .good svg { max-width: 84px; max-height: 96px; width: auto; height: auto; filter: drop-shadow(0 3px 2px rgba(0,0,0,.18)); }
.good.dis { opacity: .4; pointer-events: none; }
.label { width: 92px; padding: 2px 4px 3px; background: #fff; border-top: 5px solid #f2c400; text-align: center; box-shadow: 0 1px 1px rgba(0,0,0,.15); }
.label i { font-style: normal; display: block; font: 800 16px "Segoe UI", sans-serif; color: #d0281e; letter-spacing: -.02em; } .label small { display: block; font-size: 9.5px; line-height: 1.1; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wlP.shelf .wlBar { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 12px; } .wlP.shelf .wlBar .purse { margin: 0; font-size: 15px; }
.basket { display: flex; align-items: center; gap: 8px; } .basket b { color: var(--shu); font-size: 14px; }

/* ---- the till: a thermal receipt */
.wlP.till { display: grid; grid-template-columns: 1fr 300px; gap: 22px; width: min(820px, 96vw); padding: 20px 24px; border-radius: 6px; background: linear-gradient(180deg, #2c3a44, #1f2a31); box-shadow: 0 30px 80px rgba(0,0,0,.6); color: #eef2f3; }
.wlP.till h2 { margin: 0 0 2px; font: 600 22px var(--mincho); letter-spacing: .1em; }
.wlP.till .greet { font: 14px var(--mincho); opacity: .85; margin-bottom: 14px; }
.hot { display: flex; gap: 12px; flex-wrap: wrap; margin: 6px 0 14px; }
.hot .tray { color: var(--ink); } .hot .tray .dish { width: 96px; height: 70px; background: radial-gradient(ellipse at 50% 60%, #fff3d6 0 55%, #e8c88a 56% 60%, transparent 61%); }
.bagopt { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px; background: rgba(255,255,255,.06); cursor: pointer; margin-top: 6px; }
.bagopt .box { width: 18px; height: 18px; border-radius: 3px; border: 1.5px solid #eef2f3; display: grid; place-items: center; font-size: 13px; }
.bagopt svg { width: 32px; height: 32px; }
.receipt { position: relative; background: #fbfbf8; color: #222; padding: 16px 16px 26px; font: 12.5px/1.55 Consolas, "Courier New", monospace;
  box-shadow: 0 8px 18px rgba(0,0,0,.35); clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), 95% 100%, 90% calc(100% - 8px), 85% 100%, 80% calc(100% - 8px), 75% 100%, 70% calc(100% - 8px), 65% 100%, 60% calc(100% - 8px), 55% 100%, 50% calc(100% - 8px), 45% 100%, 40% calc(100% - 8px), 35% 100%, 30% calc(100% - 8px), 25% 100%, 20% calc(100% - 8px), 15% 100%, 10% calc(100% - 8px), 5% 100%, 0 calc(100% - 8px)); }
.receipt .shop { text-align: center; font: 700 15px var(--mincho); letter-spacing: .12em; } .receipt .ctr { text-align: center; }
.receipt .ln { display: flex; justify-content: space-between; gap: 8px; } .receipt .ln span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.receipt hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; } .receipt .tot { font-weight: 700; font-size: 15px; }
.receipt .paid { position: absolute; right: 18px; top: 46px; width: 70px; height: 70px; border-radius: 50%; border: 3px solid #c0281e; color: #c0281e; display: grid; place-items: center; font: 700 18px var(--mincho); transform: rotate(-14deg); opacity: .85; }
.wlP .paybtn { display: block; margin-top: 12px; text-align: center; padding: 10px; border-radius: 4px; background: #d9b56a; color: #1f1a14; font-weight: 700; letter-spacing: .14em; }
.wlP .paybtn:hover { background: #f0cd84; } .wlP .paybtn[disabled] { opacity: .35; pointer-events: none; }

/* ---- a vending machine */
.wlP.vend { width: min(470px, 94vw); padding: 16px 18px 18px; border-radius: 14px 14px 8px 8px; background: linear-gradient(90deg, #1b4f8c, #2366ad 50%, #1b4f8c); box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 3px #123a68; color: #fff; display: grid; grid-template-columns: 1fr 74px; gap: 12px; }
.vwin { grid-column: 1 / 3; padding: 12px 10px 4px; border-radius: 6px; background: linear-gradient(180deg, #eaf4fb, #cfe1ee); box-shadow: inset 0 0 0 3px #0f2f55, inset 0 0 24px rgba(255,255,255,.9); display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 6px; }
.slotv { display: flex; flex-direction: column; align-items: center; gap: 3px; padding-bottom: 6px; }
.slotv .dummy { height: 74px; display: grid; place-items: end center; } .slotv .dummy svg { max-height: 72px; max-width: 34px; width: auto; height: auto; filter: drop-shadow(0 2px 2px rgba(0,0,0,.2)); }
.slotv .pl { font: 700 11px "Segoe UI", sans-serif; color: #1a1a1a; background: #fff; padding: 0 6px; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
.slotv button { width: 30px; height: 14px; border-radius: 7px; background: #4c5560; box-shadow: inset 0 -2px 0 rgba(0,0,0,.35); }
.slotv button.lit { background: #46d36b; box-shadow: 0 0 10px rgba(70,211,107,.8), inset 0 -2px 0 rgba(0,0,0,.25); }
.slotv button.lit:hover { background: #7cf09a; }
.vpanel { display: grid; grid-template-rows: auto auto 1fr; gap: 8px; }
.led { padding: 5px 8px; background: #140806; border-radius: 3px; color: #ff4a2a; font: 700 18px Consolas, monospace; letter-spacing: .08em; text-align: right; text-shadow: 0 0 6px rgba(255,74,42,.8); box-shadow: inset 0 0 0 2px #333; }
.ledl { font-size: 10px; opacity: .8; letter-spacing: .1em; }
.coin { width: 40px; height: 10px; margin: 0 auto; border-radius: 5px; background: #0b1622; box-shadow: inset 0 2px 2px rgba(0,0,0,.6), 0 0 0 3px #b8c2cc; }
.outslot { grid-column: 1 / 2; position: relative; height: 54px; border-radius: 6px; background: #0b1622; box-shadow: inset 0 6px 10px rgba(0,0,0,.7), 0 0 0 3px #10345c; overflow: hidden; display: grid; place-items: center; font-size: 10px; letter-spacing: .3em; color: rgba(255,255,255,.4); }
.outslot svg { position: absolute; left: 50%; top: 50%; width: 30px; height: 60px; transform: translate(-50%, -50%) rotate(90deg); animation: wlDrop .45s cubic-bezier(.4,1.6,.6,1); }
@keyframes wlDrop { from { transform: translate(-50%, -160%) rotate(20deg); } }
.recy { height: 54px; border-radius: 6px; background: linear-gradient(180deg, #e9eef0, #c7d1d6); color: #1f4a2e; display: grid; place-items: center; text-align: center; font: 700 10px var(--mincho); cursor: pointer; box-shadow: inset 0 0 0 2px #8aa3ad; }
.recy:hover { box-shadow: inset 0 0 0 2px #46d36b; } .recy.dis { opacity: .5; pointer-events: none; }
.recy span { display: block; width: 26px; height: 6px; margin: 0 auto 4px; border-radius: 3px; background: #24343c; }
.wlP.vend .hint { grid-column: 1 / 3; color: #dbe7f3; margin-top: 0; }

/* ---- HUD: the purse and the hands */
#wlWallet { margin-top: 6px; display: flex; justify-content: flex-end; align-items: center; gap: 10px; font-size: 13px; color: var(--fg); letter-spacing: .06em; }
#wlWallet svg { width: 44px; height: 22px; opacity: .9; }
#wlWallet .bst { color: var(--accent); font: 12px var(--mincho); }
#wlPrompt { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 7px 14px 7px 8px; border-radius: 4px;
  background: linear-gradient(180deg, rgba(243,238,226,.95), rgba(226,216,196,.95)); color: #2b2420; font-size: 13px; letter-spacing: .04em; pointer-events: none; opacity: 0;
  transition: opacity .18s; z-index: 7; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
#wlPrompt b { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; background: #2b2420; color: #f3eee2; font-size: 12px; }
#wlPrompt .jp { font-family: var(--mincho); color: #6b6153; } #wlPrompt .shut { color: #b8322a; }
`;

const HUE = ['#c0392b', '#2f6fa8', '#5f8a2e', '#c98a1e', '#7a3f8a', '#1f8a86', '#b0567a', '#6b5a3e', '#3a4a8a', '#a8642a'];
// two hands seen from the back, thumbs in; fingers in the order they are used: thumb, index, middle, ring, little
function handsSVG(fill, small = false) {
  const hand = (cx, dir, k) => {
    const F = [[-30, 12, 15, 40, -38], [-17, 10, 14, 54, -4], [-3, 10, 14, 60, 0], [11, 10, 13, 55, 4], [24, 12, 11, 44, 10]]; // [x, y-from-palm, w, length, tilt]
    let s = `<rect x="${cx - 32}" y="78" width="64" height="58" rx="18" fill="#efe2cf" stroke="#2b2420" stroke-width="2"/>`;
    F.forEach(([x, , w, L, t], i) => { const fx = cx + dir * (i === 0 ? -x : -x) * -1, X = dir > 0 ? cx + x : cx - x - w, rot = dir * t, y0 = i === 0 ? 108 : 86;
      s += `<rect class="finger" x="${X}" y="${y0 - L}" width="${w}" height="${L + 8}" rx="${w / 2}" fill="${fill[k * 5 + i] || '#efe2cf'}" stroke="#2b2420" stroke-width="2" transform="rotate(${rot} ${X + w / 2} ${y0})"/>`; });
    return s + `<rect x="${cx - 30}" y="84" width="60" height="50" rx="16" fill="#efe2cf"/>`;
  };
  return `<svg class="hh" viewBox="0 0 300 140" xmlns="http://www.w3.org/2000/svg">${hand(82, -1, 1)}${hand(218, 1, 0)}<text x="82" y="133" text-anchor="middle" font-size="11" fill="#6b6153">左 left</text><text x="218" y="133" text-anchor="middle" font-size="11" fill="#6b6153">右 right</text></svg>`;
}
// the fingers each held entry takes: [right 0-4, left 5-9] -> colour
function fingerFill(fit) {
  const fill = new Array(10).fill(null), next = [0, 0];
  inv.hands.forEach((e, i) => { const a = fit && fit[i]; if (!a) return; for (const h of [0, 1]) for (let n = 0; n < a.f[h]; n++) if (next[h] < 5) fill[h * 5 + next[h]++] = HUE[i % HUE.length]; });
  return fill;
}
const PURSE = `<svg viewBox="0 0 26 22"><path d="M3 9 Q3 6 6 6 L20 6 Q23 6 23 9 L23 18 Q23 21 20 21 L6 21 Q3 21 3 18 Z" fill="#c9773a" stroke="#f6e7c4" stroke-width="1.2"/><circle cx="10" cy="4" r="2.4" fill="none" stroke="#f6e7c4" stroke-width="1.4"/><circle cx="16" cy="4" r="2.4" fill="none" stroke="#f6e7c4" stroke-width="1.4"/><path d="M3 12 L23 12" stroke="#f6e7c4" stroke-width="1"/></svg>`;
const miniHands = fill => `<svg viewBox="0 0 44 22">${[0, 1].map(h => [0, 1, 2, 3, 4].map(i => { const x = (h ? 2 : 24) + i * 3.8, c = fill[(h ? 1 : 0) * 5 + (h ? 4 - i : i)];
  return `<rect x="${x}" y="${i === (h ? 4 : 0) ? 9 : 2 + Math.abs(i - 2) * 1.2}" width="2.8" height="${i === (h ? 4 : 0) ? 8 : 12 - Math.abs(i - 2) * 1.2}" rx="1.4" fill="${c || 'rgba(242,239,230,.28)'}"/>`; }).join('')).join('')}<rect x="1" y="15" width="19" height="6" rx="3" fill="rgba(242,239,230,.28)"/><rect x="23" y="15" width="19" height="6" rx="3" fill="rgba(242,239,230,.28)"/></svg>`;

export function shopUI(opts = {}) {
  if (!document.getElementById('wlShopCss')) { const st = document.createElement('style'); st.id = 'wlShopCss'; st.textContent = css; document.head.append(st); }
  const el = (tag, attrs = {}, parent = null, html = null) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e[k] = v; } if (html != null) e.innerHTML = html; if (parent) parent.append(e); return e; };
  const prompt = el('div', { id: 'wlPrompt' }, document.body), wallet = el('div', { id: 'wlWallet' }, document.getElementById('hud') || document.body);
  const panel = el('div', { class: 'wlP' }, document.body);
  let open = null, sel = null, drag = null;
  const binNear = () => opts.binNear ? opts.binNear() : false;
  const itemOf = e => ITEMS[e.id];
  const fitNow = () => handsFit(inv.hands);

  // ---- HUD
  function hud() { const left = boostLeft(); wallet.innerHTML = `${miniHands(fingerFill(fitNow()))}<span>${yen(inv.yen)}</span>` + (left > 0 ? `<span class="bst">${inv.boost.jp} ${inv.boost.name}</span>` : ''); }
  const purse = () => `<div class="purse">${PURSE}<span>${yen(inv.yen)}</span></div>`;

  // ---- 持ち物
  const CS = 36; // (px a cell)
  function tileHTML(e, small) { const it = itemOf(e), [w, h] = sizeOf(e); return iconSVG(it); }
  function drawBag() {
    panel.className = 'wlP bag on'; panel.innerHTML = '';
    const head = el('header', {}, panel, `<h2 class="jp">持ち物</h2><span class="en">Belongings</span>${purse()}`);
    const cols = el('div', { class: 'cols' }, panel);
    // hands
    const fit = fitNow(), H = el('section', { class: 'hands' }, cols);
    el('div', { class: 'ttl' }, H, `<span>手 <small>hands</small></span><small>${fingersUsed()} / 10 fingers</small>`);
    H.insertAdjacentHTML('beforeend', handsSVG(fingerFill(fit)));
    const held = el('div', { class: 'held' }, H); held.dataset.drop = 'hands';
    inv.hands.forEach((e, i) => { const it = itemOf(e), c = el('div', { class: 'chip' + (sel === e.k ? ' sel' : ''), style: `--c:${HUE[i % HUE.length]}` }, held,
      `<div class="ic">${iconSVG(it)}</div><div class="nm">${it.name}<small>${it.jp}</small></div><div class="ff">${fingersOf(e)}本</div>${e.paid === false ? '<div class="unpaid">未</div>' : ''}`); hook(c, e); });
    if (!inv.hands.length) el('div', { style: 'font-size:12px;color:#6b6153;padding:6px 2px' }, held, 'Nothing in your hands.');
    // bags
    const B = el('section', { class: 'bags' }, cols);
    const bags = bagsOf();
    for (const b of bags) {
      const it = itemOf(b), [W, Hh] = it.grid, box = el('div', { class: 'bagbox' + (it.id === 'bag' ? ' plastic' : ''), style: it.look[1] ? `--bc:${it.look[1]}` : '' }, B);
      const used = b.items.reduce((n, o) => { const [w, h] = sizeOf(o); return n + w * h; }, 0);
      el('div', { class: 'ttl' }, box, `<span>${it.jp} <small>${it.name.toLowerCase()}${b === inv.worn ? ' · worn' : ' · ' + it.f + '本'}</small></span><small>${used} / ${W * Hh}</small>`);
      const g = el('div', { class: 'grid', style: `width:${W * CS}px;height:${Hh * CS}px;--cs:${CS}px` }, box); g.dataset.drop = b === inv.worn ? 'worn' : String(b.k); g._bag = b;
      for (const o of b.items) { const oi = itemOf(o), [w, h] = sizeOf(o), t = el('div', { class: 'tile' + (o.rot ? ' rot' : '') + (sel === o.k ? ' sel' : ''), style: `left:${o.x * CS + 1}px;top:${o.y * CS + 1}px;width:${w * CS - 2}px;height:${h * CS - 2}px;--tw:${w * CS - 8}px;--th:${h * CS - 8}px` }, g, iconSVG(oi) + (o.paid === false ? '<div class="unpaid">未</div>' : ''));
        if (o.rot) { const s = t.querySelector('svg'); s.style.width = (h * CS - 8) + 'px'; s.style.height = (w * CS - 8) + 'px'; }
        hook(t, o); }
    }
    if (!bags.length) el('div', { class: 'nobag' }, B, `<b class="jp">鞄なし — no bag</b>Without a bag all you carry is in your hands: ten fingers, and each thing takes a few — a can four, a rice ball three, a bento both hands. A daypack from the cycle shop or a konbini's plastic bag at the till holds much more.`);
    // the selected thing, and the boost
    const foot = el('div', { class: 'foot' }, panel), w = sel && whereIs(sel);
    if (w) {
      const e = w.e, it = itemOf(e), fx = effectOf(it), card = el('div', { class: 'card' }, foot);
      el('div', { class: 'big' }, card, iconSVG(it));
      const info = el('div', {}, card, `<h4>${it.name}<small>${it.jp}</small></h4><div class="facts">${it.f || it.wear ? `<span><b>${fingersOf(e)}</b> fingers to hold</span>` : ''}${it.sz ? `<span><b>${it.sz[0]}×${it.sz[1]}</b> in a bag</span>` : ''}${fx ? `<span>${fx.jp} · <b>${fx.name}</b> — ${Math.round(fx.fx * 100)}% quicker for ${Math.round(fx.t / 60 * 2) / 2} min</span>` : ''}${it.kind === 'trash' ? '<span>Goes in a recycling bin — by any vending machine, at a konbini, in the parks</span>' : ''}${e.paid === false ? '<span style="color:#b8322a"><b>未会計</b> not paid yet — the till</span>' : ''}</div>`);
      const acts = el('div', { class: 'acts' }, info);
      if (fx) { const b = el('button', { class: 'btn', textContent: isDrink(it) ? 'Drink' : 'Eat' }, acts); b.disabled = e.paid === false; b.onclick = () => { use(e.k); sel = null; }; }
      if (w.in !== 'hands') { const b = el('button', { class: 'btn ghostb', textContent: 'Take in hand' }, acts); b.onclick = () => toHands(e.k); }
      if (e.paid === false && opts.shelfNear && opts.shelfNear()) { const b = el('button', { class: 'btn ghostb', textContent: 'Put back' }, acts); b.onclick = () => { putBack(e.k); sel = null; }; }
      else if (!it.wear && e.paid !== false) { const near = binNear(), b = el('button', { class: 'btn ghostb', textContent: near ? 'Throw away' : 'No bin here' }, acts); b.disabled = !near; b.onclick = () => { discard(e.k); sel = null; }; }
    } else el('div', { class: 'card none' }, foot, bagsOf().length || inv.hands.length ? 'Click something to see it · drag it to move it · R turns it while dragged · double-click eats or drinks' : 'Nothing carried. Konbini, shops and vending machines sell food and drinks.');
    const left = boostLeft(), st = el('div', { class: 'stamp' + (left > 0 ? '' : ' off') }, foot);
    st.innerHTML = left > 0 ? `<div class="seal">${inv.boost.jp}</div><small>${inv.boost.name} · ${Math.ceil(left / 60)} min</small>` : `<div class="seal">空腹</div><small>nothing eaten lately</small>`;
    el('div', { class: 'hint' }, panel, '<span class="key">I</span> / <span class="key">Tab</span> / <span class="key">Esc</span> close');
  }
  // a chip or a tile: click selects, double-click eats or drinks, a drag moves it
  function hook(node, e) {
    node.addEventListener('dblclick', ev => { ev.preventDefault(); if (effectOf(itemOf(e))) { use(e.k); sel = null; } });
    node.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; ev.preventDefault(); const r = node.getBoundingClientRect(); drag = { e, x0: ev.clientX, y0: ev.clientY, ox: ev.clientX - r.left, oy: ev.clientY - r.top, rot: e.rot || 0, on: false, node }; });
  }
  function ghostAt(ev) {
    const e = drag.e, [w, h] = sizeOf(e, drag.rot);
    if (!drag.g) { drag.g = el('div', { class: 'tile ghost' }, document.body, iconSVG(itemOf(e))); }
    const G = drag.g; G.style.width = (w * CS - 2) + 'px'; G.style.height = (h * CS - 2) + 'px';
    const s = G.querySelector('svg'); if (drag.rot) { s.style.width = (h * CS - 8) + 'px'; s.style.height = (w * CS - 8) + 'px'; s.style.transform = 'rotate(90deg)'; } else { s.style.width = s.style.height = ''; s.style.transform = ''; }
    const gx = ev.clientX - Math.min(drag.ox, w * CS - 10), gy = ev.clientY - Math.min(drag.oy, h * CS - 10); G.style.left = gx + 'px'; G.style.top = gy + 'px';
    // the cells under it
    document.querySelectorAll('.ghostcell').forEach(n => n.remove()); document.querySelectorAll('.held.drop').forEach(n => n.classList.remove('drop'));
    const tgt = document.elementsFromPoint(ev.clientX, ev.clientY).find(n => n.dataset && n.dataset.drop); drag.tgt = null;
    if (!tgt) return;
    if (tgt.dataset.drop === 'hands') { tgt.classList.add('drop'); drag.tgt = { hands: true }; return; }
    const r = tgt.getBoundingClientRect(), cx = Math.round((gx - r.left) / CS), cy = Math.round((gy - r.top) / CS), ok = cellsFree(tgt._bag, w, h, cx, cy, e);
    el('div', { class: 'ghostcell' + (ok ? '' : ' bad'), style: `left:${cx * CS}px;top:${cy * CS}px;width:${w * CS}px;height:${h * CS}px` }, tgt);
    drag.tgt = { bag: tgt.dataset.drop === 'worn' ? 'worn' : +tgt.dataset.drop, x: cx, y: cy, ok };
  }
  addEventListener('pointermove', ev => { if (!drag) return; if (!drag.on && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 5) { drag.on = true; drag.node.style.opacity = .35; } if (drag.on) ghostAt(ev); });
  addEventListener('pointerup', ev => {
    if (!drag) return; const d = drag; drag = null; document.querySelectorAll('.ghostcell').forEach(n => n.remove()); if (d.g) d.g.remove();
    if (!d.on) { sel = sel === d.e.k ? null : d.e.k; render(); return; }
    if (d.tgt && d.tgt.hands) toHands(d.e.k); else if (d.tgt && d.tgt.ok) toBag(d.e.k, d.tgt.bag, d.tgt.x, d.tgt.y, d.rot); render();
  });
  addEventListener('contextmenu', ev => { if (drag && drag.on) { ev.preventDefault(); drag.rot ^= 1; ghostAt(ev); } else if (open) ev.preventDefault(); });
  addEventListener('keydown', ev => { if (drag && drag.on && ev.code === 'KeyR') { drag.rot ^= 1; ghostAt({ clientX: drag.lx ?? drag.x0, clientY: drag.ly ?? drag.y0 }); } }, true);
  addEventListener('pointermove', ev => { if (drag) { drag.lx = ev.clientX; drag.ly = ev.clientY; } });

  // ---- a shop's menu, as its trade shows it
  const greetOf = c => c.menu.greet || '';
  function bar(parent, note) { const b = el('div', { class: 'wlBar' }, parent); el('span', {}, b, note); b.insertAdjacentHTML('beforeend', purse()); return b; }
  function order(c, id) { const it = ITEMS[id]; if (buy(id)) { if (opts.onBought) opts.onBought(c, it); render(); } }
  const takeNote = it => it.here ? 'eaten here' : (it.f ? it.f + ' fingers' : '');
  function drawBoard(c) {
    panel.className = 'wlP board on'; panel.innerHTML = '';
    const nm = c.jp.length > 4 ? [c.title] : [...c.title]; const nc = { 0: '#7a1f1a', 3: '#1f2a44', 12: '#1d1d1d', 16: '#22344a' }[c.trade] || '#1f2a44';
    el('div', { class: 'noren', style: `--nc:${nc}` }, panel, nm.map(ch => `<span>${ch}</span>`).join(''));
    el('div', { class: 'who' }, panel, `<div class="bubble">「${greetOf(c)}」</div><div class="lbl">${c.jp} · ${c.menu.label} · お品書き</div>`);
    const S = el('div', { class: 'strips' }, panel);
    for (const id of c.menu.items) { const it = ITEMS[id], ok = inv.yen >= it.price;
      const s = el('div', { class: 'strip' + (ok ? '' : ' dis'), title: it.name }, S, `<div class="ill">${iconSVG(it)}</div><span class="v">${it.jp}</span><span class="pr">${it.price.toLocaleString('ja-JP')}円</span><span class="en">${it.name}</span>`);
      s.onclick = () => order(c, id); }
    bar(panel, 'Click a strip to order — eaten at the counter. <span class="key">E</span> / <span class="key">Esc</span> leave');
  }
  function drawCard(c) {
    panel.className = 'wlP cardm on'; panel.innerHTML = '';
    el('h2', { textContent: 'Menu' }, panel); el('div', { class: 'wlSubt', textContent: c.title + ' ・ ' + c.jp }, panel); el('div', { class: 'greet', textContent: '「' + greetOf(c) + '」' }, panel);
    for (const id of c.menu.items) { const it = ITEMS[id], r = el('div', { class: 'mrow' + (inv.yen >= it.price ? '' : ' dis') }, panel, `<div class="ic">${iconSVG(it)}</div><div class="nm">${it.name}<small>${it.jp} · ${takeNote(it)}</small></div><div class="dots"></div><div class="pr">${yen(it.price)}</div>`); r.onclick = () => order(c, id); }
    bar(panel, '<span class="key">E</span> / <span class="key">Esc</span> leave');
  }
  function drawCase(c) {
    panel.className = 'wlP case on'; panel.innerHTML = '';
    el('header', {}, panel, `<h2>${c.title}</h2><span class="en">${c.jp} · ${c.menu.label}</span><div class="bubble" style="margin-left:auto">「${greetOf(c)}」</div>`);
    const g = el('div', { class: 'glass' }, panel);
    for (const id of c.menu.items) { const it = ITEMS[id], ok = inv.yen >= it.price && (it.here || canCarry(id)), t = el('div', { class: 'tray' + (ok ? '' : ' dis') }, g, `<div class="dish">${iconSVG(it)}</div><div class="tent"><b>${it.jp}</b><small>${it.name} · ${takeNote(it)}</small><i>${it.price.toLocaleString('ja-JP')}円</i></div>`); t.onclick = () => order(c, id); }
    bar(panel, 'Click to buy — taken with you (into your bag, or your hands). <span class="key">E</span> / <span class="key">Esc</span> leave');
  }
  // ---- a shelf (taken unpaid) and the till
  function drawShelf(sec) {
    panel.className = 'wlP shelf on' + (sec.fridge ? ' fridge' : ''); panel.innerHTML = '';
    el('header', {}, panel, `<h2>${sec.jp}</h2><span class="en">${sec.name}</span>`);
    const rack = el('div', { class: 'rack' }, panel), per = sec.items.length > 6 ? Math.ceil(sec.items.length / 2) : sec.items.length;
    for (let r = 0; r < sec.items.length; r += per) {
      const tier = el('div', { class: 'tier' }, rack), edge = el('div', { class: 'edge' }, rack);
      for (const id of sec.items.slice(r, r + per)) { const it = ITEMS[id], ok = canCarry(id);
        const g = el('div', { class: 'good' + (ok ? '' : ' dis'), title: ok ? it.name : why(id) }, tier, iconSVG(it)); g.onclick = () => { if (take(id)) render(); };
        el('div', { class: 'label' }, edge, `<i>${it.price}円</i><small>${it.jp}</small>`); }
    }
    const U = unpaid(), b = bar(panel, `<span class="basket">${U.length ? `未会計 <b>${yen(unpaidTotal())}</b> · ${U.length} item${U.length > 1 ? 's' : ''} — pay at the till` : 'Click to take one — pay at the till'}</span>`);
    el('div', { class: 'hint' }, panel, `${fingersUsed()} / 10 fingers in use${bagsOf().length ? '' : ' · no bag'} · <span class="key">I</span> belongings · <span class="key">E</span> / <span class="key">Esc</span> step back`);
  }
  let withBag = false, lastPaid = null;
  function drawTill(c) {
    panel.className = 'wlP till on'; panel.innerHTML = '';
    const L = el('div', {}, panel), U = unpaid(), menu = c.menu;
    el('h2', { textContent: c.title }, L); el('div', { class: 'greet', textContent: '「' + (lastPaid ? menu.thanks || 'ありがとうございました' : U.length ? 'お預かりします。' : greetOf(c)) + '」' }, L);
    const hot = (menu.till || []).filter(id => id !== 'bag');
    if (hot.length) { el('div', { style: 'font-size:11px;letter-spacing:.2em;opacity:.7', textContent: 'ホットスナック · BY THE TILL' }, L); const H = el('div', { class: 'hot' }, L);
      for (const id of hot) { const it = ITEMS[id], ok = canCarry(id), t = el('div', { class: 'tray' + (ok ? '' : ' dis') }, H, `<div class="dish">${iconSVG(it)}</div><div class="tent"><b>${it.jp}</b><i>${it.price}円</i></div>`); t.onclick = () => { if (take(id)) { lastPaid = null; render(); } }; } }
    if ((menu.till || []).includes('bag')) { const o = el('div', { class: 'bagopt' }, L, `<div class="box">${withBag ? '✓' : ''}</div>${iconSVG(ITEMS.bag)}<div>レジ袋 · a plastic bag <b>¥3</b><br><small style="opacity:.7">its handles take 2 fingers; holds 5×4</small></div>`); o.onclick = () => { withBag = !withBag; render(); }; }
    el('div', { class: 'hint', style: 'text-align:left' }, L, `${fingersUsed()} / 10 fingers in use · <span class="key">E</span> / <span class="key">Esc</span> leave`);
    // the receipt
    const R2 = el('div', {}, panel), rc = el('div', { class: 'receipt' }, R2), now = new Date();
    const lines = lastPaid ? lastPaid.lines : U.map(e => [ITEMS[e.id].name, ITEMS[e.id].price]);
    if (!lastPaid && withBag && U.length) lines.push(['Plastic bag', ITEMS.bag.price]);
    const total = lines.reduce((n, l) => n + l[1], 0);
    rc.innerHTML = `<div class="shop">${c.jp}</div><div class="ctr">${c.title}</div><div class="ctr">${now.toLocaleDateString('ja-JP')}</div><hr>` + (lines.length ? lines.map(([n, p]) => `<div class="ln"><span>${n}</span><span>¥${p}</span></div>`).join('') : '<div class="ctr" style="opacity:.6">— nothing to pay —</div>')
      + `<hr><div class="ln tot"><span>合計 TOTAL</span><span>${yen(total)}</span></div>` + (lastPaid ? `<div class="ln"><span>お預り</span><span>${yen(lastPaid.given)}</span></div><div class="ln"><span>お釣り</span><span>${yen(lastPaid.given - total)}</span></div><div class="paid">済</div>` : `<div class="ln"><span>財布 wallet</span><span>${yen(inv.yen)}</span></div>`);
    const pb = el('button', { class: 'paybtn', textContent: lastPaid ? 'ありがとうございました' : 'Pay  ' + yen(total) }, R2); pb.disabled = !!lastPaid || !U.length || inv.yen < total;
    pb.onclick = () => { const given = Math.ceil(total / 1000) * 1000 || total; const L2 = lines.slice(); if (payAll(withBag)) { lastPaid = { lines: L2, given: Math.max(given, total) }; withBag = false; if (opts.onPaid) opts.onPaid(c); render(); } };
  }
  // ---- a vending machine
  let dropped = null;
  function drawVend(c) {
    panel.className = 'wlP vend on'; panel.innerHTML = '';
    const win = el('div', { class: 'vwin' }, panel);
    for (const id of c.menu.items) { const it = ITEMS[id], ok = inv.yen >= it.price && canCarry(id), s = el('div', { class: 'slotv' }, win, `<div class="dummy">${iconSVG(it)}</div><div class="pl">${it.price}</div>`);
      const b = el('button', { class: ok ? 'lit' : '', title: ok ? it.name : inv.yen < it.price ? 'Not enough money' : why(id) }, s); b.onclick = () => { if (!ok) { toastMsg(b.title); return; } if (buy(id)) { dropped = id; render(); } }; }
    const out = el('div', { class: 'outslot' }, panel, dropped ? iconSVG(ITEMS[dropped]) : 'とりだしぐち');
    const side = el('div', { class: 'vpanel' }, panel); el('div', { class: 'ledl', textContent: '投入金額' }, side); el('div', { class: 'led', textContent: inv.yen.toLocaleString('en') }, side); el('div', { class: 'coin' }, side);
    const n = empties().length, rc = el('div', { class: 'recy' + (n ? '' : ' dis'), style: 'grid-column:2;grid-row:3' }, panel, `<div><span></span>あきかん<br>ペットボトル${n ? '<br>(' + n + ')' : ''}</div>`);
    rc.onclick = () => { const k = binEmpties(); if (k) toastMsg(k + ' empt' + (k > 1 ? 'ies' : 'y') + ' into the recycling box'); render(); };
    el('div', { class: 'hint' }, panel, `${c.jp} · press a lit button · the recycling box takes empty cans and bottles · <span class="key">E</span> / <span class="key">Esc</span>`);
  }
  // ---- your farm (home.js): the seed rack, the farm board
  const BAND = { lettuce: '#5f9a36', cabbage: '#7aa84e', sunflower: '#e2a414', potato: '#a07a45', tomato: '#c8321e', bean: '#4f8a2e', strawberry: '#d0284a', corn: '#d9a11e', pumpkin: '#d86a12', watermelon: '#2f6a2a' };
  function drawSeeds(c) {
    panel.className = 'wlP seeds on'; panel.innerHTML = '';
    el('header', {}, panel, `<h2>${c.jp} · 種苗</h2><span class="en">${c.title} — sow a plot</span>`);
    const G = el('div', { class: 'pk' }, panel), k = c.sprinkler ? 1.5 : 1;
    for (const s of c.seeds) { const ok = inv.yen >= s.price, h = Math.round(s.hours / k * 10) / 10;
      const p = el('div', { class: 'pkt' + (ok ? '' : ' dis'), style: `--band:${BAND[s.crop] || '#5f9a36'}`, title: ok ? s.name : 'Not enough money' }, G, `<span class="jpn">${s.jp}</span>${iconSVG(s)}<b>${s.name}</b><small>ripe in ${h} h · sells ${yen(s.sell)}</small><i>${s.price}円</i>`);
      p.onclick = () => { if (!ok) return; if (c.pick(s.crop)) { open = null; panel.className = 'wlP'; } }; }
    bar(panel, `Click a packet to sow it${c.sprinkler ? ' · the sprinklers: the field grows 1.5× as fast' : ''} — the hours are the game's (a night's sleep in your bed). <span class="key">E</span> / <span class="key">Esc</span>`);
  }
  function drawFarm(c0) {
    const c = c0.refresh ? c0.refresh() : c0;
    panel.className = 'wlP farm on'; panel.innerHTML = '';
    const top = el('div', { class: 'top' }, panel);
    el('div', { class: 'note title' }, top, `<h2>${c.title}</h2><div class="en">${c.sub}</div>`);
    el('div', { class: 'note stats' }, top, c.stats.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join(''));
    const A = el('div', { class: 'acts' }, panel);
    for (const a of c.acts) { const ok = !a.done && inv.yen >= a.price;
      const n = el('div', { class: 'note act' + (a.done ? ' done' : ok ? '' : ' dis') }, A, `<h4>${a.label}</h4><div class="jp" style="font-size:12px">${a.jp}</div><small>${a.note}</small><span class="pr">${a.done ? 'bought' : yen(a.price)}</span>${a.done ? '<div class="stamp">済</div>' : ''}`);
      n.onclick = () => { if (!ok) { if (!a.done) toastMsg('Not enough money'); return; } a.run(); render(); }; }
    bar(panel, 'Plots are sown and harvested at the plot itself (E). Harvests go into the shipping box: paid at once. <span class="key">E</span> / <span class="key">Esc</span>');
  }
  function render() {
    if (!open) return;
    if (open.kind === 'seeds') return drawSeeds(open.c); if (open.kind === 'farm') return drawFarm(open.c);
    if (open.kind === 'bag') drawBag(); else if (open.kind === 'board') drawBoard(open.c); else if (open.kind === 'card') drawCard(open.c); else if (open.kind === 'case' || open.kind === 'tag') drawCase(open.c);
    else if (open.kind === 'shelf') drawShelf(open.c); else if (open.kind === 'till') drawTill(open.c); else if (open.kind === 'vend') drawVend(open.c);
  }
  onInventory(() => { hud(); if (open && !drag) render(); });
  hud();
  return {
    hud, render,
    prompt(html) { if (html) { prompt.innerHTML = html; prompt.style.opacity = 1; } else prompt.style.opacity = 0; },
    // open a panel: 'bag' | 'board' | 'card' | 'case' | 'tag' | 'shelf' | 'till' | 'vend' (c: the counter, shelf, till or machine)
    show(kind, c = null) { open = { kind, c }; sel = null; dropped = null; if (kind === 'till') { lastPaid = null; withBag = false; } render(); },
    close() { open = null; drag = null; panel.className = 'wlP'; document.querySelectorAll('.ghost, .ghostcell').forEach(n => n.remove()); },
    isOpen: () => !!open, kind: () => open && open.kind,
  };
}
