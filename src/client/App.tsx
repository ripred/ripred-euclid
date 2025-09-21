import React, { useEffect, useRef, useState } from 'react';
import { Devvit } from '@devvit/public-api';

/* ===== app version (tiny watermark) ===== */
const APP_VERSION = 'v2025.09.20.05';
const VersionStamp: React.FC = () => (
  <div style={{position:'fixed', top:6, right:8, fontSize:10, lineHeight:1, opacity:.6, color:'var(--muted)', zIndex:80}}>
    {APP_VERSION}
  </div>
);

/* ===== theme (FOLLOW user/Devvit light/dark) ===== */
const GlobalStyles = () => (
  <style>{`
    /* --- Light theme defaults --- */
    :root{
      --bg:#f8fafc; --text:#111827; --muted:#4b5563;
      --card-bg:#ffffff; --card-border:#e5e7eb;

      --empty-fill:#f3f4f6; --empty-stroke:#9ca3af;

      --dot-red-stroke:#ef4444; --dot-red-fill:#fee2e2;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#dbeafe;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.10); --pill-blue:rgba(59,130,246,.10);

      --last-red-ring:rgba(239,68,68,.65);
      --last-blue-ring:rgba(59,130,246,.65);
      --last-red-glow:rgba(239,68,68,.35);
      --last-blue-glow:rgba(59,130,246,.35);

      --glint-light:rgba(255,255,255,.50);
      --glint-mid:rgba(255,255,255,.20);
    }

    /* --- Prefer dark: OS/browser choice --- */
    @media (prefers-color-scheme: dark) {
      :root{
        --bg:#0b1220; --text:#f3f4f6; --muted:#9ca3af;
        --card-bg:#111827; --card-border:#374151;

        --empty-fill:#1f2937; --empty-stroke:#d1d5db;

        --dot-red-stroke:#ef4444; --dot-red-fill:#7f1d1d;
        --dot-blue-stroke:#3b82f6; --dot-blue-fill:#1e3a8a;

        --line-red:252,97,97; --line-blue:96,165,250;

        --pill-red:rgba(239,68,68,.20); --pill-blue:rgba(59,130,246,.20);

        --last-red-ring:rgba(239,68,68,.80);
        --last-blue-ring:rgba(59,130,246,.80);
        --last-red-glow:rgba(239,68,68,.50);
        --last-blue-glow:rgba(59,130,246,.50);

        --glint-light:rgba(255,255,255,.36);
        --glint-mid:rgba(255,255,255,.16);
      }
    }

    /* --- Explicit Dev/host toggles (classes/attributes) override OS --- */
    html.dark, body.dark,
    html[data-theme="dark"], body[data-theme="dark"],
    html[data-color-scheme="dark"], body[data-color-scheme="dark"]{
      --bg:#0b1220; --text:#f3f4f6; --muted:#9ca3af;
      --card-bg:#111827; --card-border:#374151;

      --empty-fill:#1f2937; --empty-stroke:#d1d5db;

      --dot-red-stroke:#ef4444; --dot-red-fill:#7f1d1d;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#1e3a8a;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.20); --pill-blue:rgba(59,130,246,.20);

      --last-red-ring:rgba(239,68,68,.80);
      --last-blue-ring:rgba(59,130,246,.80);
      --last-red-glow:rgba(239,68,68,.50);
      --last-blue-glow:rgba(59,130,246,.50);

      --glint-light:rgba(255,255,255,.36);
      --glint-mid:rgba(255,255,255,.16);
    }
    html.light, body.light,
    html[data-theme="light"], body[data-theme="light"],
    html[data-color-scheme="light"], body[data-color-scheme="light"]{
      --bg:#f8fafc; --text:#111827; --muted:#4b5563;
      --card-bg:#ffffff; --card-border:#e5e7eb;

      --empty-fill:#f3f4f6; --empty-stroke:#9ca3af;

      --dot-red-stroke:#ef4444; --dot-red-fill:#fee2e2;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#dbeafe;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.10); --pill-blue:rgba(59,130,246,.10);

      --last-red-ring:rgba(239,68,68,.65);
      --last-blue-ring:rgba(59,130,246,.65);
      --last-red-glow:rgba(239,68,68,.35);
      --last-blue-glow:rgba(59,130,246,.35);

      --glint-light:rgba(255,255,255,.50);
      --glint-mid:rgba(255,255,255,.20);
    }

    html, body, #root { height: 100%; background: var(--bg); }
    body { color-scheme: light dark; margin: 0; overflow: hidden; }

    .glow-red { box-shadow: 0 0 0 3px rgba(239,68,68,.6), 0 0 18px rgba(239,68,68,.45); }
    .glow-blue{ box-shadow: 0 0 0 3px rgba(59,130,246,.6), 0 0 18px rgba(59,130,246,.45); }

    .anim__animated{animation-duration:.6s;animation-fill-mode:both;}
    @keyframes zoomIn_kf{from{opacity:0;transform:scale3d(.3,.3,.3)}50%{opacity:1}}
    .anim__zoomIn{animation-name:zoomIn_kf}
    @keyframes lastPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
    .last__pulse{animation:lastPulse 900ms ease-out 2}
    @keyframes glintSlide{0%{transform:translateX(-140%)}100%{transform:translateX(140%)}}
    .glint-wrap{position:relative;display:inline-block;padding:2px 6px;border-radius:8px;overflow:hidden}
    .glint-bar{position:absolute;inset:0;background:linear-gradient(90deg,transparent,var(--glint-mid),var(--glint-light),var(--glint-mid),transparent);transform:translateX(-140%);animation:glintSlide 2.2s ease;pointer-events:none;filter:blur(1px)}
  `}</style>
);

/* ===== model ===== */
class Point { x:number; y:number; index:number;
  constructor(x:number,y:number){ this.x=x; this.y=y; this.index=y*Board.WIDTH+x; }
  valid(){ return this.x>=0 && this.x<Board.WIDTH && this.y>=0 && this.y<Board.HEIGHT; }
}
class Square { p1:Point; p2:Point; p3:Point; p4:Point; points:number; remain:number; clr:number;
  constructor(p1:Point,p2:Point,p3:Point,p4:Point,clr:number,points:number,remain:number){ this.p1=p1; this.p2=p2; this.p3=p3; this.p4=p4; this.points=points; this.remain=remain; this.clr=clr; this.normalize(); }
  normalize(){ const pts=[this.p1,this.p2,this.p3,this.p4]; let changed=true; while(changed){ changed=false; for(let k=0;k<3;k++){ if(pts[k].y>pts[k+1].y){ [pts[k],pts[k+1]]=[pts[k+1],pts[k]]; changed=true; }}} if(pts[0].y!==pts[1].y){ if(pts[1].x>pts[2].x)[pts[1],pts[2]]=[pts[2],pts[1]]; } else { if(pts[0].x<pts[1].x)[pts[0],pts[1]]=[pts[1],pts[0]]; if(pts[2].x<pts[3].x)[pts[2],pts[3]]=[pts[3],pts[2]]; } [this.p1,this.p2,this.p3,this.p4]=pts; }
}
class Player { m_squares:Square[]=[]; m_score=0; m_lastNumSquares=0; m_playStyle:number; m_goofs=false; m_computer:boolean; userId='';
  constructor(playStyle:number=Board.PS_OFFENSIVE, computer=false, userId=''){ this.m_playStyle=playStyle; this.m_computer=computer; this.userId=userId; }
  initGame(){ this.m_squares=[]; this.m_lastNumSquares=0; this.m_score=0; }
}

/* ===== board + AI ===== */
class Board {
  static GS_RUNNING=0; static GS_PLAYER1WIN=1; static GS_PLAYER2WIN=2; static GS_TIE=3;
  static PS_BRUTAL=0; static PS_OFFENSIVE=1; static PS_DEFENSIVE=2; static PS_CASUAL=3;
  static WIDTH=8; static HEIGHT=8;

  m_board:number[]=[]; m_players:Player[]=[]; m_turn=0; m_history:Point[]=[]; m_displayed_game_over=false;
  m_onlyShowLastSquares=false; m_createRandomizedRangeOrder=true; m_stopAt150=true;
  m_last:Point; m_lastPoints=0;
  m_targets:(string|null)[]=[null,null];

  constructor(p1:Player,p2:Player,skip=false){ this.m_players=[p1,p2]; this.m_last=new Point(-1,-1); if(!skip) this.initGame(); }
  initGame(){ this.m_board=new Array(Board.WIDTH*Board.HEIGHT).fill(0); this.m_history=[]; this.m_turn=0; this.m_displayed_game_over=false; this.m_last=new Point(-1,-1); this.m_players[0].initGame(); this.m_players[1].initGame(); this.m_targets=[null,null]; }
  pointAt(x:number,y:number){ return new Point(x,y); }
  createRandomizedRange(size:number){ const a=[...Array(size).keys()]; for(let p=0;p<size*size;p++){ const i=Math.floor(Math.random()*size),j=Math.floor(Math.random()*size); if(i!==j){[a[i],a[j]]=[a[j],a[i]]}} return a; }

  analyze(move:Point,potential:Square[]|null){ let total=0; const x=move.x,y=move.y,clr=this.m_turn+1;
    if(potential) potential.length=0; const other=(clr===1)?2:1;
    const rows=this.createRandomizedRange(Board.HEIGHT), columns=this.createRandomizedRange(Board.WIDTH);
    for(let index=0;index<Board.WIDTH*Board.HEIGHT;index++){
      const row=rows[Math.floor(index/Board.WIDTH)], col=columns[index%Board.WIDTH];
      const dx=col-x, dy=row-y, x1=x-dy,y1=y+dx,x2=col-dy,y2=row+dx;
      if(x1<0||x1>=Board.WIDTH||y1<0||y1>=Board.HEIGHT||x2<0||x2>=Board.WIDTH||y2<0||y2>=Board.HEIGHT||(col===x&&row===y)) continue;
      const v1=this.m_board[y*Board.WIDTH+x], v2=this.m_board[row*Board.WIDTH+col], v3=this.m_board[y1*Board.WIDTH+x1], v4=this.m_board[y2*Board.WIDTH+x2];
      if(v1===other||v2===other||v3===other||v4===other) continue;
      const remain=(v1===0?1:0)+(v2===0?1:0)+(v3===0?1:0)+(v4===0?1:0);
      const left=Math.min(x,col,x1,x2), top=Math.min(y,row,y1,y2), right=Math.max(x,col,x1,x2), bottom=Math.max(y,row,y1,y2);
      const score=(right-left+1)*(bottom-top+1);
      const sq=new Square(this.pointAt(x,y),this.pointAt(col,row),this.pointAt(x1,y1),this.pointAt(x2,y2),clr,score,remain);
      if(remain===0){
        total+=score;
        if(!this.m_players[this.m_turn].m_squares.some(s=>s.p1.index===sq.p1.index&&s.p2.index===sq.p2.index&&s.p3.index===sq.p3.index&&s.p4.index===sq.p4.index&&s.points===sq.points&&s.remain===sq.remain&&s.clr===sq.clr)){
          this.m_players[this.m_turn].m_squares.push(sq);
          this.m_players[this.m_turn].m_lastNumSquares++;
        }
      } else if(potential){
        if(!potential.some(s=>s.p1.index===sq.p1.index&&s.p2.index===sq.p2.index&&s.p3.index===sq.p3.index&&s.p4.index===sq.p4.index&&s.points===sq.points&&s.remain===sq.remain&&s.clr===sq.clr)){
          potential.push(sq);
        }
      }
    }
    return total;
  }

  private scoreIfPlacedForColor(pt:Point, color:number){ const saved=this.m_board[pt.index]; const savedTurn=this.m_turn; this.m_board[pt.index]=color; this.m_turn=color-1;
    let total=0; const x=pt.x,y=pt.y,other=color===1?2:1;
    for(let row=0;row<Board.HEIGHT;row++){
      for(let col=0;col<Board.WIDTH;col++){
        const dx=col-x,dy=row-y,x1=x-dy,y1=y+dx,x2=col-dy,y2=row+dx;
        if(x1<0||x1>=Board.WIDTH||y1<0||y1>=Board.HEIGHT||x2<0||x2>=Board.WIDTH||y2<0||y2>=Board.HEIGHT||(col===x&&row===y)) continue;
        const v1=this.m_board[y*Board.WIDTH+x],v2=this.m_board[row*Board.WIDTH+col],v3=this.m_board[y1*Board.WIDTH+x1],v4=this.m_board[y2*Board.WIDTH+x2];
        if(v1===other||v2===other||v3===other||v4===other) continue;
        const remain=(v1===0?1:0)+(v2===0?1:0)+(v3===0?1:0)+(v4===0?1:0);
        if(remain===0){ const left=Math.min(x,col,x1,x2),top=Math.min(y,row,y1,y2),right=Math.max(x,col,x1,x2),bottom=Math.max(y,row,y1,y2); total+=(right-left+1)*(bottom-top+1); }
      }
    }
    this.m_board[pt.index]=saved; this.m_turn=savedTurn; return total; }

  private static sqKeyByIndices(...idx:number[]):string{ return idx.slice().sort((a,b)=>a-b).join(','); }

  private collectSquaresForColor(color:number):Square[]{
    const saveTurn=this.m_turn; this.m_turn=color-1;
    const all:Square[]=[];
    for(let y=0;y<Board.HEIGHT;y++){
      for(let x=0;x<Board.WIDTH;x++){
        const cur:Square[]=[]; this.analyze(this.pointAt(x,y),cur);
        for(const s of cur){
          if(!all.some(t=>t.p1.index===s.p1.index&&t.p2.index===s.p2.index&&t.p3.index===s.p3.index&&t.p4.index===s.p4.index&&t.points===s.points&&t.remain===s.remain&&t.clr===s.clr)){
            all.push(s);
          }
        }
      }
    }
    this.m_turn=saveTurn;
    return all;
  }

  private shouldMistake(maxVal:number):boolean{
    if(maxVal<0) return false;
    if(maxVal===0) return true;
    return Math.floor(Math.random()*maxVal)===0;
  }

  private randomEmptyPoint():Point{
    const empties:number[]=[]; for(let i=0;i<this.m_board.length;i++){ if(this.m_board[i]===0) empties.push(i); }
    if(empties.length===0) return this.pointAt(0,0);
    const pick=empties[Math.floor(Math.random()*empties.length)];
    return this.pointAt(pick%Board.WIDTH, Math.floor(pick/Board.WIDTH));
  }

  private chooseUnifiedMove(defMax:number, offMax:number):Point{
    const me=this.m_turn; const myClr=me+1; const oppClr=myClr===1?2:1;

    // 1) DEFENSE: block opponent's best immediate completion
    let bestBlockPts=-1; let bestBlock=this.pointAt(0,0); let foundThreat=false;
    for(let i=0;i<this.m_board.length;i++){
      if(this.m_board[i]!==0) continue;
      const pt=this.pointAt(i%Board.WIDTH, Math.floor(i/Board.WIDTH));
      const oppGain=this.scoreIfPlacedForColor(pt, oppClr);
      if(oppGain>bestBlockPts){ bestBlockPts=oppGain; bestBlock=pt; }
      if(oppGain>0) foundThreat=true;
    }
    if(foundThreat && !this.shouldMistake(defMax)){
      return bestBlock;
    }

    // 2) OFFENSE: persist/choose max-area target
    const opp=oppClr;
    const getEmptyBestCorner=(idxs:number[]):Point|null=>{
      let best:Point|null=null, bestImm=-1;
      for(const idx of idxs){
        if(this.m_board[idx]!==0) continue;
        const pt=this.pointAt(idx%Board.WIDTH, Math.floor(idx/Board.WIDTH));
        const imm=this.scoreIfPlacedForColor(pt, myClr);
        if(imm>bestImm){ bestImm=imm; best=pt; }
      }
      return best;
    };

    const currentKey=this.m_targets[me]; let targetKey:string|null=currentKey;

    const keyToPlayableCorner=(key:string|null):Point|null=>{
      if(!key) return null;
      const parts=key.split(',').map(s=>parseInt(s,10));
      for(const idx of parts){ if(this.m_board[idx]===opp) return null; }
      let ours=0; for(const idx of parts){ if(this.m_board[idx]===myClr) ours++; }
      if(ours===4) return null;
      return getEmptyBestCorner(parts);
    };

    let playPt:Point|null=keyToPlayableCorner(targetKey);

    if(!playPt){
      const cand=this.collectSquaresForColor(myClr).filter(s=>{
        const idxs=[s.p1.index,s.p2.index,s.p3.index,s.p4.index];
        for(const idx of idxs){ if(this.m_board[idx]===opp) return false; }
        return true;
      });
      if(cand.length>0){
        let maxPts=0; for(const s of cand) if(s.points>maxPts) maxPts=s.points;
        const top=cand.filter(s=>s.points===maxPts);
        let minRemain=Math.min(...top.map(s=>s.remain));
        const top2=top.filter(s=>s.remain===minRemain).sort((a,b)=>{
          const ka=Board.sqKeyByIndices(a.p1.index,a.p2.index,a.p3.index,a.p4.index);
          const kb=Board.sqKeyByIndices(b.p1.index,b.p2.index,b.p3.index,b.p4.index);
          return ka<kb?-1:ka>kb?1:0;
        });
        const chosen=top2[0];
        targetKey=Board.sqKeyByIndices(chosen.p1.index,chosen.p2.index,chosen.p3.index,chosen.p4.index);
        this.m_targets[me]=targetKey;
        playPt=keyToPlayableCorner(targetKey);
      }
    }

    if(playPt){ if(this.shouldMistake(offMax)) return this.randomEmptyPoint(); return playPt; }
    return this.randomEmptyPoint();
  }

  findBestMove(){
    const style=this.m_players[this.m_turn].m_playStyle;
    switch(style){
      case Board.PS_BRUTAL:    return this.chooseUnifiedMove(-1, -1);
      case Board.PS_OFFENSIVE: return this.chooseUnifiedMove( 3, -1);
      case Board.PS_DEFENSIVE: return this.chooseUnifiedMove(-1,  3);
      case Board.PS_CASUAL:    return this.chooseUnifiedMove( 2,  2);
      default:                 return this.chooseUnifiedMove( 2,  2); // <- default to Casual
    }
  }

  makeMove(){ const m=this.findBestMove(); this.placePiece(m); return m; }
  placePiece(pt:Point){ if(!pt.valid()||this.m_board[pt.index]>0) return 0; this.m_board[pt.index]=this.m_turn+1; this.m_history.push(pt); this.m_last=this.pointAt(pt.x,pt.y); const points=this.analyze(pt,null); this.m_players[this.m_turn].m_score+=points; return points; }
  advanceTurn(){ this.m_turn=(this.m_turn+1)%2; }
  checkGameOver(){ if(this.m_players[0].m_score>=150) return 1; if(this.m_players[1].m_score>=150) return 2; return 0; }
  toJSON(){ return { m_board:this.m_board, m_players:this.m_players, m_turn:this.m_turn, m_history:this.m_history, m_displayed_game_over:this.m_displayed_game_over, m_onlyShowLastSquares:this.m_onlyShowLastSquares, m_createRandomizedRangeOrder:this.m_createRandomizedRangeOrder, m_stopAt150:this.m_stopAt150, m_last:{x:this.m_last.x,y:this.m_last.y,index:this.m_last.index}, m_lastPoints:this.m_lastPoints, playerNames:(this as any).playerNames||{}, playerAvatars:(this as any).playerAvatars||{}, m_targets:this.m_targets }; }
  static fromJSON(j:any){
    const b=new Board(new Player(1,false,j?.m_players?.[0]?.userId??''), new Player(1,false,j?.m_players?.[1]?.userId??''), true);
    b.m_board=j.m_board; b.m_players=j.m_players; b.m_turn=j.m_turn;
    b.m_history=(j.m_history||[]).map((p:any)=>new Point(p.x,p.y));
    (b as any).playerNames=j.playerNames||{}; (b as any).playerAvatars=j.playerAvatars||{};
    b.m_last=new Point(j.m_last?.x??-1,j.m_last?.y??-1);
    b.m_targets=(j.m_targets as (string|null)[]|undefined) ?? [null,null];
    return b;
  }
  clone(){ return Board.fromJSON(this.toJSON()); }
}

/* ===== helpers ===== */
const isBoardValid = (b:any): b is Board =>
  !!b && Array.isArray(b.m_board) && b.m_board.length === 64 &&
  Array.isArray(b.m_players) && b.m_players.length === 2;

/* ===== ScoreCard ===== */
const ScoreCard:React.FC<{
  label:string; score:number; align:'left'|'right'; glow?: 'red'|'blue'|null; avatar?:string; compact?:boolean;
}> = ({ label, score, align, glow=null, avatar, compact=false }) => {
  const width = compact ? 'clamp(160px, 44vw, 210px)' : 'clamp(200px, 42vw, 230px)';
  return (
    <div className={`flex flex-col ${align==='right'?'items-end':'items-start'}`}>
      <div className={`flex items-center justify-between px-3 py-1 rounded-md shadow-sm ${glow==='red'?'glow-red':''} ${glow==='blue'?'glow-blue':''}`}
        style={{width, background:'var(--card-bg)', border:`1px solid var(--card-border)`}}>
        <div className="flex items-center gap-2" style={{color:'var(--text)', minWidth:0}}>
          {avatar ? <img src={avatar} alt="" style={{width:22,height:22,borderRadius:'50%'}}/> : <span style={{width:22,height:22,borderRadius:'50%',background:'var(--empty-stroke)'}}/>}
          <span className="font-medium" style={{display:'inline-block', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis', maxWidth: compact ? 120 : 150}} title={label}>{label}</span>
        </div>
        <span className="font-semibold" style={{color:'var(--text)'}}>{score}</span>
      </div>
    </div>
  );
};

/* ===== Simple Confetti (no deps) ===== */
const Confetti: React.FC<{ show: boolean }> = ({ show }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!show) return;
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight;
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#a855f7','#ec4899'];
    const N = 140;
    const parts = Array.from({length:N}, () => ({
      x: Math.random()*w, y: -20 - Math.random()*h*0.5,
      vx: (Math.random()-0.5)*2, vy: 2 + Math.random()*3,
      size: 6 + Math.random()*6, rot: Math.random()*Math.PI, vr: (Math.random()-0.5)*0.2,
      color: colors[Math.floor(Math.random()*colors.length)]
    }));
    let running = true, t0 = performance.now(), dur = 1800;
    const tick = (t:number) => {
      if (!running) return;
      const dt = Math.min(32, t - t0); t0 = t;
      ctx.clearRect(0,0,w,h);
      for (const p of parts) {
        p.x += p.vx * dt/16; p.y += p.vy * dt/16; p.rot += p.vr * dt/16;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); ctx.restore();
      }
      if (t - (t0 - dt) < dur) requestAnimationFrame(tick); else running = false;
    };
    requestAnimationFrame(tick);
    return () => { running = false; window.removeEventListener('resize', onResize); };
  }, [show]);
  if (!show) return null;
  return <canvas ref={ref} style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:55}} />;
};

/* ===== Admin metrics types ===== */
type AdminMetrics = {
  uniques: Record<string, number>;
  counts: Record<string, number>;
  computed: Record<string, number>;
  aiDiffs: Record<string, number>;
  activeGames: number;
  rankedPlayers: { hvh: number; hva: number };
};

/* ===== App ===== */
type Mode='ai'|'multiplayer'|'spectate'|'rankings'|'admin'|null;

export const App=(context:Devvit.Context)=>{
  const [mode,setMode]=useState<Mode>(null);
  const [board,setBoard]=useState<Board|null>(null);
  const [selectedStyle,setSelectedStyle]=useState(Board.PS_CASUAL);
  const [status,setStatus]=useState<string>('');
  const [winner,setWinner]=useState<number|null>(null);
  const [finalSide,setFinalSide]=useState<number|null>(null);
  const [finalReason,setFinalReason]=useState<string>('');
  const [isMobile,setIsMobile]=useState(false);
  const [notice,setNotice]=useState<string>('');
  const [showRules,setShowRules]=useState(false);
  const [glintOn,setGlintOn]=useState(false);
  const soloRecordedRef = useRef(false);
  const aiFirstSentRef = useRef(false);
  const [aiTie, setAiTie] = useState(false);

  // H2H state/polling
  const [gameId,setGameId]=useState<string|null>(null);
  const gameIdRef = useRef<string|null>(null);
  const [isPlayer1,setIsPlayer1]=useState<boolean>(false);
  const [spectating,setSpectating]=useState<boolean>(false);
  const pollRef=useRef<number|null>(null);
  const pollActiveRef = useRef<'none'|'mapping'|'state'>('none');
  const stopPolling=()=>{ if(pollRef.current){ clearInterval(pollRef.current); pollRef.current=null; } };

  // window/theme basics
  useEffect(()=>{ const onResize=()=>setIsMobile(typeof window!=='undefined'&&window.innerWidth<=768); onResize(); window.addEventListener('resize',onResize); return()=>window.removeEventListener('resize',onResize);},[]);
  useEffect(()=>{ (async()=>{ try{ await fetch('/api/init'); }catch{} })(); },[]);
  useEffect(()=>{ const id=setInterval(()=>{ setGlintOn(true); setTimeout(()=>setGlintOn(false), 2200); }, 15000) as unknown as number; return ()=>clearInterval(id); },[]);

  // record AI result (win/loss only; tie has no ELO)
  useEffect(()=>{
    if(mode!=='ai' || !winner || !board || soloRecordedRef.current) return;
    const you = board.m_players?.[0]?.m_score ?? 0;
    const bot = board.m_players?.[1]?.m_score ?? 0;
    const diff =
      selectedStyle===Board.PS_BRUTAL ? 'brutal' :
      selectedStyle===Board.PS_OFFENSIVE ? 'offensive' :
      selectedStyle===Board.PS_DEFENSIVE ? 'defensive' : 'casual';
    (async ()=>{ try{
      await fetch('/api/solo/record', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ difficulty: diff, youScore: you, botScore: bot })});
    }catch{} soloRecordedRef.current=true; })();
  },[mode,winner,board,selectedStyle]);

  /* === H2H polling helpers === */
  const refreshStateOnce = async () => {
    const gid = gameIdRef.current; if(!gid) return;
    try{
      const r=await fetch(`/api/h2h/state?gameId=${encodeURIComponent(gid)}`);
      if (r.status === 410) { setNotice('Game ended (stale or cleared).'); stopPolling(); pollActiveRef.current='none'; return; }
      const j=await r.json();
      if (j.ended) {
        let side=j.victorSide??null;
        if (!side && j.board) {
          const s1=j.board.m_players?.[0]?.m_score??0, s2=j.board.m_players?.[1]?.m_score??0;
          side = s1>s2 ? 1 : s2>s1 ? 2 : null;
        }
        setFinalSide(side);
        setFinalReason(j.endedReason||'game_over');
        if ((j.endedReason||'') === 'tie') setNotice('Tie game!');
        stopPolling(); pollActiveRef.current='none';
      }
      if(j.board) setBoard(Board.fromJSON(j.board));
    }catch{}
  };

  const pollGame = () => {
    if (pollActiveRef.current==='state') return;
    stopPolling(); pollActiveRef.current='state';
    pollRef.current = window.setInterval(refreshStateOnce, 1000) as unknown as number;
  };

  const pollMapping = () => {
    if (pollActiveRef.current==='mapping') return;
    stopPolling(); pollActiveRef.current='mapping';
    pollRef.current = window.setInterval(async () => {
      try {
        const r=await fetch('/api/h2h/mapping');
        const j=await r.json();
        if (j?.gameId) {
          if (!gameIdRef.current) { setGameId(j.gameId); gameIdRef.current=j.gameId; }
          if (typeof j.isPlayer1==='boolean') setIsPlayer1(j.isPlayer1);
          if (j.board) {
            setBoard(Board.fromJSON(j.board));
            setSpectating(false);
            setMode('multiplayer'); setStatus(''); setNotice(''); setFinalSide(null); setFinalReason('');
            stopPolling(); pollActiveRef.current='none';
            pollGame(); // switch to state
          } else {
            // nudge state in case board already written
            refreshStateOnce();
          }
        }
      } catch {}
    }, 1000) as unknown as number;
  };

  // SAFETY NET: if in multiplayer and board invalid/missing, always show waiting view and keep mapping polling alive
  useEffect(()=>{ if (mode==='multiplayer' && !isBoardValid(board)) pollMapping(); },[mode,board]);

  /* ===== Spectate list ===== */
  const [games,setGames]=useState<{gameId:string; names:Record<string,string>; scores:number[]; lastSaved:number; ended:boolean}[]>([]);
  const loadGames = async () => { try{ const r=await fetch('/api/games/list'); const j=await r.json(); setGames((j.games||[]).slice().sort((a:any,b:any)=>(b.lastSaved||0)-(a.lastSaved||0))); }catch{} };

  /* ===== Rankings ===== */
  type RankingRow = { userId:string; name:string; avatar?:string; rating:number; games:number; wins:number; losses:number; draws:number };
  const [rankings,setRankings]=useState<{hvh:RankingRow[]; hva:RankingRow[]}>({hvh:[],hva:[]});
  const loadRankings = async () => { try{ const r=await fetch('/api/rankings'); const j=await r.json(); setRankings({ hvh:(j.hvh||[]), hva:(j.hva||[]) }); }catch{} };

  /* ===== Admin metrics ===== */
  const [admin,setAdmin]=useState<AdminMetrics|null>(null);
  const loadAdmin = async () => { try{ const r=await fetch('/api/admin/metrics'); const j=await r.json(); setAdmin(j); }catch{ setAdmin(null); } };

  /* ===== Secret keys: 'ripred' in-game = assist+unlock '.', outside game = Admin; '.' = assist (BRUTAL) ===== */
  const [cheatsUnlocked,setCheatsUnlocked] = useState(false);
  const cheatsUnlockedRef = useRef(false); useEffect(()=>{ cheatsUnlockedRef.current=cheatsUnlocked; },[cheatsUnlocked]);

  const brutalPlayForHuman = async () => {
    if (!board || winner || finalSide) return;
    // Always force BRUTAL (no mistakes) when assisting
    if (mode==='ai') {
      if (board.m_turn!==0) return;
      const saved=board.m_players[0].m_playStyle; board.m_players[0].m_playStyle=Board.PS_BRUTAL;
      const m=board.findBestMove(); board.m_players[0].m_playStyle=saved;
      if (m) {
        board.placePiece(board.pointAt(m.x,m.y));
        const st=board.checkGameOver(); if(st!==0){ setWinner(st); setBoard(board.clone()); return; }
        if (!board.m_board.some(v=>v===0)) { setAiTie(true); setBoard(board.clone()); return; }
        board.advanceTurn();
        setTimeout(()=>{ board.m_players[1].m_playStyle = selectedStyle; board.makeMove(); const st2=board.checkGameOver();
          if(st2!==0) setWinner(st2); else { if (!board.m_board.some(v=>v===0)) { setAiTie(true); setBoard(board.clone()); return; } board.advanceTurn(); }
          setBoard(board.clone());
        }, 250);
        setBoard(board.clone());
      }
    } else if (mode==='multiplayer') {
      const gid=gameIdRef.current; if(!gid) return;
      const myTurn=(board.m_turn===0)===isPlayer1; if(!myTurn || spectating) return;
      const saved=board.m_players[board.m_turn].m_playStyle; board.m_players[board.m_turn].m_playStyle=Board.PS_BRUTAL;
      const m=board.findBestMove(); board.m_players[board.m_turn].m_playStyle=saved;
      if (m) {
        board.placePiece(board.pointAt(m.x,m.y));
        const st=board.checkGameOver(); if(st!==0){ setWinner(st); } else { board.advanceTurn(); }
        try{ await fetch('/api/h2h/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:gid,board:board.toJSON()})}); }catch{}
        setBoard(board.clone());
        setTimeout(refreshStateOnce,200); setTimeout(refreshStateOnce,400); setTimeout(refreshStateOnce,800);
      }
    }
  };

  useEffect(()=>{
    const secret='ripred'; let idx=0;
    const onKey=(e:KeyboardEvent)=>{
      const k=(e.key||'').toLowerCase(); if(!k) return;
      if (k==='.' && cheatsUnlockedRef.current) { if((mode==='ai')||(mode==='multiplayer'&&board)) brutalPlayForHuman(); return; }
      if (k.length===1){
        if (k===secret[idx]){ idx++; if (idx===secret.length){ idx=0; if((mode==='ai')||(mode==='multiplayer'&&board)){ brutalPlayForHuman(); setCheatsUnlocked(true); } else { setMode('admin'); loadAdmin(); } } }
        else { idx=(k===secret[0])?1:0; }
      }
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[mode,board,isPlayer1,spectating,winner,finalSide,selectedStyle]);

  /* ===== Rules Overlay ===== */
  const RulesOverlay = showRules ? (
    <div className="anim__animated anim__zoomIn" onClick={()=>setShowRules(false)} style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:60, background:'rgba(0,0,0,.55)'}}>
      <div onClick={(e)=>e.stopPropagation()} style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`, borderRadius:12, padding:'16px 22px', maxWidth:680, width:'min(92vw, 680px)', maxHeight:'82vh', overflowY:'auto', fontSize:'0.95rem'}}>
          <div style={{fontSize:'1.125rem', fontWeight:800, marginBottom:8}}>How to Play — Euclid</div>
          <ul style={{paddingLeft: '1.2em', listStyle:'disc'}}>
              <li>Players take turns placing a dot on an 8×8 grid.</li>
              <li>A <b>square</b> is completed when all four of its corner cells are your color. The four corners don’t need to be axis-aligned — they can form a rotated square.</li>
              <li><b>Scoring:</b> Points for each completed square are the <b>area of the axis-aligned bounding square/rectangle</b> that encloses those four corners: <b>width × height</b>.</li>
              <li>One move can complete multiple <b>squares</b>; you score the sum of their areas.</li>
              <li>First to <b>150</b> points wins. If both reach 150 on the same turn, higher total wins; ties are possible.</li>
              <li>You can block an opponent by occupying a needed corner before they do.</li>
          </ul>
        <div className="mt-3" style={{display:'flex', justifyContent:'flex-end', marginTop:12}}>
          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={()=>setShowRules(false)}>Close</button>
        </div>
      </div>
    </div>
  ) : null;

  /* =========================
     CONTENT ROUTER
     ========================= */
  let content: JSX.Element;

  /* ===== Intro ===== */
  if(mode===null){
    content = (
      <div className="flex flex-col justify-center items-center gap-6" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        {RulesOverlay}
        <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid</h1>

        <div className="flex flex-col items-center gap-2">
          <label className="font-medium" style={{color:'var(--muted)'}}>AI Mode</label>
          <select className="rounded px-4 py-2" style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`}} value={selectedStyle} onChange={(e)=>setSelectedStyle(Number(e.target.value))}>
            <option value={Board.PS_BRUTAL}>Brutal</option>
            <option value={Board.PS_OFFENSIVE}>Offensive</option>
            <option value={Board.PS_DEFENSIVE}>Defensive</option>
            <option value={Board.PS_CASUAL}>Casual</option>
          </select>
        </div>

        <div className="flex gap-3 flex-wrap items-center justify-center">
          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{ try{ await fetch('/api/metrics/ai-click',{method:'POST'});}catch{} const p1=new Player(selectedStyle,false), p2=new Player(selectedStyle,true); const b=new Board(p1,p2); setBoard(b); setWinner(null); soloRecordedRef.current=false; aiFirstSentRef.current=false; setAiTie(false); setMode('ai'); }}>
            Play vs AI
          </button>

          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{
              setStatus('Queuing…');
              try{
                const r=await fetch('/api/h2h/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                const j=JSON.parse(await r.text());
                if(j.paired && j.gameId){
                  setGameId(j.gameId); gameIdRef.current=j.gameId;
                  if(typeof j.isPlayer1==='boolean') setIsPlayer1(j.isPlayer1);
                  if(j.board && isBoardValid(j.board)){
                    setBoard(Board.fromJSON(j.board)); setSpectating(false);
                    setMode('multiplayer'); setStatus(''); setNotice(''); setFinalSide(null); setFinalReason('');
                    pollGame();
                  } else {
                    setSpectating(false); setMode('multiplayer'); setStatus('Paired — loading board…'); pollMapping();
                  }
                } else {
                  setSpectating(false); setMode('multiplayer'); setStatus('Waiting for an opponent…'); pollMapping();
                }
              }catch(e:any){ setStatus('Queue failed: '+(e?.message||e)); }
            }}>
            Play vs Human
          </button>

          <button className="rounded cursor-pointer" style={{background:'#374151', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{ await loadGames(); setMode('spectate'); }}>
            Spectate
          </button>

          <button className="rounded cursor-pointer" style={{background:'#16a34a', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{ await loadRankings(); setMode('rankings'); }}>
            Rankings
          </button>

          <button className="rounded cursor-pointer" style={{background:'#6b7280', color:'#fff', padding:'8px 16px'}} onClick={()=>setShowRules(true)}>
            Rules
          </button>
        </div>

        {status && <div className="text-sm" style={{color:'var(--muted)'}}>{status}</div>}
      </div>
    );
  }

  /* ===== Spectate ===== */
  else if(mode==='spectate'){
    content = (
      <div className="flex flex-col justify-center items-center gap-4" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid — Spectate</h1>
        <div className="w-[min(640px,92vw)] flex-1 overflow-y-auto flex flex-col gap-2" style={{color:'var(--text)'}}>
          {games.length===0 && <div style={{color:'var(--muted)'}}>No active games right now.</div>}
          {games.map(g=>{
            const uids=Object.keys(g.names||{}); const n1=g.names[uids[0]]||'Player 1'; const n2=g.names[uids[1]]||'Player 2';
            return (
              <div key={g.gameId} className="flex justify-between items-center px-3 py-2 rounded" style={{background:'var(--card-bg)',border:`1px solid var(--card-border)`}}>
                <div>{n1} vs {n2} <span style={{color:'var(--muted)'}}>— {g.scores[0]} : {g.scores[1]}</span></div>
                <div className="flex gap-2">
                  <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}}
                    onClick={async()=>{
                      setGameId(g.gameId); gameIdRef.current=g.gameId;
                      try{ const r=await fetch(`/api/h2h/state?gameId=${encodeURIComponent(g.gameId)}`); const j=await r.json(); if(j.board){ setBoard(Board.fromJSON(j.board)); } }catch{}
                      setSpectating(true); pollGame(); setMode('multiplayer'); setStatus('Spectating — read only');
                    }}>Watch</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{paddingTop:8}}>
          <button className="rounded cursor-pointer" style={{background:'#6b7280', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ===== Rankings (scrollable center; Back stays visible) ===== */
  else if(mode==='rankings'){
    const numCell = { color:'var(--text)', textAlign:'right' as const, fontVariantNumeric:'tabular-nums' as const };
    const headCell = { color:'var(--muted)', fontWeight:700, textAlign:'right' as const };
    const Section = ({title, rows, accent}:{title:string; rows:any[]; accent:'red'|'blue'}) => (
      <div className="w-[min(720px,92vw)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-extrabold" style={{color:'var(--text)'}}>{title}</h2>
        </div>
        <div className="rounded-lg overflow-hidden" style={{border:`1px solid var(--card-border)`}}>
          <div className="grid grid-cols-[56px_1fr_90px_80px] md:grid-cols-[56px_1fr_120px_90px_90px_90px]" style={{background:'var(--card-bg)'}}>
            <div className="px-3 py-2 font-bold" style={{color:'var(--muted)'}}>Rank</div>
            <div className="px-3 py-2 font-bold" style={{color:'var(--muted)'}}>Player</div>
            <div className="px-3 py-2 font-bold hidden md:block" style={headCell}>Rating</div>
            <div className="px-3 py-2 font-bold" style={headCell}>Games</div>
            <div className="px-3 py-2 font-bold hidden md:block" style={headCell}>Wins</div>
            <div className="px-3 py-2 font-bold hidden md:block" style={headCell}>Losses</div>
          </div>
          <div style={{maxHeight:'48vh', overflowY:'auto'}}>
            {rows.map((r: any, i: number)=>{
              const top3 = i<3; const pill = accent==='red' ? 'var(--pill-red)' : 'var(--pill-blue)';
              return (
                <div key={r.userId} className="grid grid-cols-[56px_1fr_90px_80px] md:grid-cols-[56px_1fr_120px_90px_90px_90px] items-center"
                     style={{borderTop:`1px solid var(--card-border)`, background: top3 ? pill : 'transparent'}}>
                  <div className="px-3 py-2 font-extrabold" style={{color: accent==='red'?'#b91c1c':'#1d4ed8'}}>{i+1}</div>
                  <div className="px-3 py-2 flex items-center gap-2" style={{color:'var(--text)'}}>
                    {r.avatar ? <img src={r.avatar} alt="" style={{width:24,height:24,borderRadius:'50%'}}/> : <span style={{width:24,height:24,borderRadius:'50%',background:'var(--empty-stroke)'}}/>}
                    <span className="truncate" title={r.name||r.userId}>{r.name||r.userId}</span>
                  </div>
                  <div className="px-3 py-2 hidden md:block" style={numCell}>{r.rating}</div>
                  <div className="px-3 py-2" style={numCell}>{r.games}</div>
                  <div className="px-3 py-2 hidden md.block" style={numCell as any}>{r.wins}</div>
                  <div className="px-3 py-2 hidden md.block" style={numCell as any}>{r.losses}</div>
                </div>
              );
            })}
            {rows.length===0 && <div className="px-3 py-4" style={{color:'var(--muted)'}}>No ranked players yet.</div>}
          </div>
        </div>
      </div>
    );

    content = (
      <div className="flex flex-col items-center" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        <div style={{paddingTop:16, paddingBottom:8}}>
          <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid — Rankings</h1>
        </div>
        <div className="flex-1 overflow-y-auto w-full flex flex-col items.center gap-6" style={{paddingBottom:8}}>
          <Section title="Head-to-Head (Human vs Human)" rows={rankings.hvh} accent="red" />
          <Section title="Human vs Computer (All Difficulties)" rows={rankings.hva} accent="blue" />
        </div>
        {/* Back button always visible; rankings content scrolls above */}
        <div style={{padding:12}}>
          <button className="rounded cursor.pointer" style={{background:'#6b7280', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ===== Admin (scrollable body; OK always visible) ===== */
  else if(mode==='admin'){
    content = (
      <div className="flex flex.col items.center" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        <div style={{paddingTop:16, paddingBottom:8}}>
          <h1 className="text-2xl font.bold text.center" style={{color:'var(--text)'}}>Euclid — Admin Metrics</h1>
        </div>

        <div className="w-[min(860px,94vw)] rounded-lg flex-1 overflow.y-auto"
             style={{background:'var(--card-bg)', border:`1px solid var(--card-border)`, padding:'4px 2px'}}>
          <div className="grid grid.cols-1 md:grid.cols-2 gap-0">
            <div className="p-4" style={{borderRight:`1px solid var(--card-border)`}}>
              <div className="font.bold mb-2" style={{color:'var(--muted)'}}>Unique users</div>
              <ul style={{color:'var(--text)', lineHeight:1.6, fontVariantNumeric:'tabular-nums'}}>
                <li>App started: {admin?.uniques?.app_start_users ?? 0}</li>
                <li>H2H clicked: {admin?.uniques?.h2h_click_users ?? 0}</li>
                <li>H2H started: {admin?.uniques?.h2h_started_users ?? 0}</li>
                <li>H2H completed: {admin?.uniques?.h2h_completed_users ?? 0}</li>
                <li>AI clicked: {admin?.uniques?.ai_click_users ?? 0}</li>
                <li>AI first move: {admin?.uniques?.ai_first_users ?? 0}</li>
                <li>AI completed: {admin?.uniques?.ai_completed_users ?? 0}</li>
              </ul>
              <div className="font.bold mt-4 mb-2" style={{color:'var(--muted)'}}>Computed (never …)</div>
              <ul style={{color:'var(--text)', lineHeight:1.6, fontVariantNumeric:'tabular-nums'}}>
                <li>H2H: clicked but never played: {admin?.computed?.h2h_clicked_never_started ?? 0}</li>
                <li>H2H: started but never finished: {admin?.computed?.h2h_started_never_finished ?? 0}</li>
                <li>AI: clicked but never played: {admin?.computed?.ai_clicked_never_started ?? 0}</li>
                <li>AI: started but never finished: {admin?.computed?.ai_started_never_finished ?? 0}</li>
              </ul>
            </div>
            <div className="p-4">
              <div className="font.bold mb-2" style={{color:'var(--muted)'}}>Event counts</div>
              <ul style={{color:'var(--text)', lineHeight:1.6, fontVariantNumeric:'tabular-nums'}}>
                <li>App starts: {admin?.counts?.app_start_count ?? 0}</li>
                <li>H2H clicks: {admin?.counts?.h2h_click_count ?? 0}</li>
                <li>H2H pairs: {admin?.counts?.h2h_started_count ?? 0}</li>
                <li>H2H game overs: {admin?.counts?.h2h_game_over_count ?? 0}</li>
                <li>H2H cancel queue: {admin?.counts?.h2h_cancel_queue_count ?? 0}</li>
                <li>H2H opponent left: {admin?.counts?.h2h_opponent_left_count ?? 0}</li>
                <li>H2H player left: {admin?.counts?.h2h_player_left_count ?? 0}</li>
                <li>AI clicks: {admin?.counts?.ai_click_count ?? 0}</li>
                <li>AI first moves: {admin?.counts?.ai_first_count ?? 0}</li>
                <li>AI completes: {admin?.counts?.ai_completed_count ?? 0}</li>
              </ul>
              <div className="font.bold mt-4 mb-2" style={{color:'var(--muted)'}}>AI difficulty breakdown</div>
              <ul style={{color:'var(--text)', lineHeight:1.6, fontVariantNumeric:'tabular-nums'}}>
                <li>Casual: {admin?.aiDiffs?.casual ?? 0}</li>
                <li>Offensive: {admin?.aiDiffs?.offensive ?? 0}</li>
                <li>Defensive: {admin?.aiDiffs?.defensive ?? 0}</li>
                <li>Brutal: {admin?.aiDiffs?.brutal ?? 0}</li>
              </ul>
            </div>
          </div>
          <div className="p-4 flex flex.wrap items.center justify.between" style={{borderTop:`1px solid var(--card-border)`, color:'var(--text)'}}>
            <div>Active H2H games: <b>{admin?.activeGames ?? 0}</b></div>
            <div>Ranked players — H2H: <b>{admin?.rankedPlayers?.hvh ?? 0}</b> / HvA: <b>{admin?.rankedPlayers?.hva ?? 0}</b></div>
          </div>
        </div>

        {/* OK button always visible below the scroll area */}
        <div style={{padding:12}}>
          <button className="rounded cursor.pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); }}>
            ok
          </button>
        </div>
      </div>
    );
  }

  /* ===== Multiplayer ===== */
  else if(mode==='multiplayer' && !isBoardValid(board)){
    // Waiting view (paired, or finding match) — mapping poll runs in background
    content = (
      <div className="flex flex.col justify.center items.center gap-5" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        <h1 className="text-2xl font.bold text.center" style={{color:'var(--text)'}}>Euclid</h1>
        <div className="glint-wrap text-sm" style={{color:'var(--muted)', position:'relative'}}>
          {glintOn && <span className="glint-bar" aria-hidden="true" />}
          {status || 'Paired — loading board…'}
        </div>

        <div className="flex gap-2">
          {/* Back cancels queue */}
          <button className="rounded cursor.pointer" style={{background:'#6b7280', color:'#fff', padding:'6px 12px'}}
            onClick={async ()=>{
              stopPolling(); pollActiveRef.current='none';
              try { await fetch('/api/h2h/cancelQueue', { method: 'POST' }); } catch {}
              setGameId(null); gameIdRef.current=null;
              setIsPlayer1(false); setSpectating(false); setBoard(null);
              setMode(null); setStatus(''); setNotice(''); setWinner(null); setFinalSide(null); setFinalReason('');
            }}>
            Back
          </button>

          {/* Quick switch to AI */}
          <button className="rounded cursor.pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}}
            onClick={async ()=>{
              stopPolling(); pollActiveRef.current='none';
              try { await fetch('/api/h2h/cancelQueue', { method: 'POST' }); } catch {}
              try { await fetch('/api/metrics/ai-click', { method:'POST' }); } catch {}
              const p1=new Player(selectedStyle,false);
              const p2=new Player(selectedStyle,true);
              const b=new Board(p1,p2);
              setBoard(b); setWinner(null); soloRecordedRef.current=false; aiFirstSentRef.current=false; setAiTie(false);
              setMode('ai');
            }}>
            Play the Computer Instead …
          </button>
        </div>
      </div>
    );
  }

  else if(mode==='multiplayer' && isBoardValid(board)){
    const p1Id=(board as any).m_players?.[0]?.userId||''; const p2Id=(board as any).m_players?.[1]?.userId||'';
    const names=(board as any).playerNames||{}; const avatars=(board as any).playerAvatars||{};
    const p1Name=names[p1Id]||'Red'; const p2Name=names[p2Id]||'Blue';
    const isMyTurn=(board.m_turn===0)===isPlayer1;

    const onCellClick=async(x:number,y:number)=>{
      const gid = gameIdRef.current; if(!board||!gid) return;
      if(spectating) return;
      if(!isMyTurn || board.m_board[y*Board.WIDTH+x]>0 || winner || finalSide) return;

      board.placePiece(board.pointAt(x,y));
      const st=board.checkGameOver(); if(st!==0){ setWinner(st); } else { board.advanceTurn(); }

      try{
        await fetch('/api/h2h/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:gid,board:board.toJSON()})});
      }catch{}

      setBoard(board.clone());
      setTimeout(refreshStateOnce, 200);
      setTimeout(refreshStateOnce, 400);
      setTimeout(refreshStateOnce, 800);
    };

    const midText = finalSide
      ? ((finalSide===1 ? p1Name : p2Name) + ' wins!')
      : (spectating ? 'Spectating — read only' : (isMyTurn ? 'Your move' : `Waiting on ${(board.m_turn===0?p1Name:p2Name)}…`));

    const decided = finalSide ?? winner ?? null;
    const showWinner=!!decided;
    const winnerLabel = decided===1 ? p1Name : p2Name;
    const youAreWinner = (decided===1 && isPlayer1) || (decided===2 && !isPlayer1);
    const winnerText = youAreWinner ? 'You win!' : `${winnerLabel} wins!`;

    const overlay = (notice || showWinner) ? (
      <div className="anim__animated anim__zoomIn"
           style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, background:'rgba(0,0,0,.55)'}}>
        <Confetti show={!!showWinner} />
        <div style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`, borderRadius:12, padding:'16px 22px', textAlign:'center', maxWidth:520, zIndex:60}}>
          {showWinner ? (
            <>
              <div style={{fontSize:'1.2rem', fontWeight:800, marginBottom:8}}>{winnerText}</div>
              <div style={{color:'var(--muted)', marginBottom:12}}>Final: {p1Name} {board.m_players[0].m_score} — {board.m_players[1].m_score} {p2Name}</div>
            </>
          ) : (
            <div style={{fontSize:'1.1rem', fontWeight:800, marginBottom:8}}>{notice}</div>
          )}
          <button className="rounded cursor.pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}}
            onClick={()=>{ setMode(null); setBoard(null); setStatus(''); setNotice(''); setWinner(null); setFinalSide(null); setFinalReason(''); }}>
            Close
          </button>
        </div>
      </div>
    ) : null;

    content = (
      <GameScreen
        modeName="Multiplayer"
        isMobile={isMobile}
        board={board}
        onCellClick={onCellClick}
        onLeave={async ()=>{
          try{ await fetch('/api/h2h/leave',{method:'POST'}); }catch{}
          stopPolling(); pollActiveRef.current='none';
          setGameId(null); gameIdRef.current=null;
          setIsPlayer1(false); setSpectating(false); setBoard(null);
          setMode(null); setStatus(''); setNotice(''); setWinner(null); setFinalSide(null); setFinalReason('');
        }}
        p1Name={p1Name}
        p2Name={p2Name}
        yourTurn={isMyTurn}
        midText={midText}
        glowSide={finalSide ? null : (spectating ? null : (isMyTurn ? (isPlayer1 ? 'red' : 'blue') : null))}
        dimSide={finalSide ? null : (spectating ? null : (isMyTurn ? (isPlayer1 ? 'blue' : 'red') : null))}
        overlay={overlay}
        p1Avatar={avatars[p1Id]}
        p2Avatar={avatars[p2Id]}
      />
    );
  }

  /* ===== AI ===== */
  else if(mode==='ai' && isBoardValid(board)){
    const style=selectedStyle;
    const p1Name='You';
    const p2Name =
      style===Board.PS_BRUTAL    ? 'Bot (Brutal)'    :
      style===Board.PS_OFFENSIVE ? 'Bot (Offensive)' :
      style===Board.PS_DEFENSIVE ? 'Bot (Defensive)' :
                                   'Bot (Casual)';

    const onCellClick=(x:number,y:number)=>{
      if(board.m_turn!==0 || board.m_board[y*Board.WIDTH+x]>0 || winner || aiTie) return;
      if (!aiFirstSentRef.current) { try { fetch('/api/metrics/ai-first', { method:'POST' }); } catch {} aiFirstSentRef.current = true; }
      board.placePiece(board.pointAt(x,y));
      const st=board.checkGameOver();
      if(st!==0){ setWinner(st); setBoard(board.clone()); return; }
      if (!board.m_board.some(v=>v===0)) { setAiTie(true); setBoard(board.clone()); return; }
      board.advanceTurn();
      setTimeout(()=>{
        board.m_players[1].m_playStyle = style;
        board.makeMove();
        const st2=board.checkGameOver();
        if(st2!==0) setWinner(st2);
        else {
          if (!board.m_board.some(v=>v===0)) { setAiTie(true); setBoard(board.clone()); return; }
          board.advanceTurn();
        }
        setBoard(board.clone());
      }, 1000);
      setBoard(board.clone());
    };

    const midText = winner ? ((winner===1?'You':'Bot') + ' win!') : (aiTie ? 'Tie game!' : (board.m_turn===0 ? 'Your move' : 'Waiting on Bot…'));

    const overlay = (winner || aiTie) ? (
      <div className="anim__animated anim__zoomIn"
           style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, background:'rgba(0,0,0,.55)'}}>
        <Confetti show={!!winner} />
        <div style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`, borderRadius:12, padding:'16px 22px', textAlign:'center'}}>
          <div style={{fontSize:'1.2rem', fontWeight:800, marginBottom:8}}>{winner ? (winner===1?'You win!':'Bot wins!') : 'Tie game!'}</div>
          <button className="rounded cursor.pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}}
            onClick={()=>{ setWinner(null); setAiTie(false); setBoard(null); soloRecordedRef.current=false; aiFirstSentRef.current=false; setMode(null); setStatus(''); setNotice(''); }}>
            Close
          </button>
        </div>
      </div>
    ) : null;

    content = (
      <div style={{position:'relative', height:'100vh', background:'var(--bg)'}}>
        <GameScreen
          modeName="AI"
          isMobile={isMobile}
          board={board}
          onCellClick={onCellClick}
          onLeave={()=>{ setWinner(null); setAiTie(false); setBoard(null); soloRecordedRef.current=false; aiFirstSentRef.current=false; setMode(null); setStatus(''); setNotice(''); }}
          p1Name={p1Name}
          p2Name={p2Name}
          yourTurn={board.m_turn===0}
          midText={midText}
          glowSide={winner || aiTie ? null : (board.m_turn===0 ? 'red' : 'blue')}
          dimSide={winner || aiTie ? null : (board.m_turn===0 ? 'blue' : 'red')}
          overlay={overlay}
        />
      </div>
    );
  }

  // fallback
  else {
    content = (
      <div className="flex flex.col justify.center items.center gap-5" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
        <div style={{color:'var(--text)'}}>Loading…</div>
      </div>
    );
  }

  /* ===== Unconditional globals + content ===== */
  return (
    <>
      <GlobalStyles />
      <VersionStamp />
      {content}
    </>
  );
};

/* ===== Screen (board renderer) ===== */
const GameScreen:React.FC<{
  modeName:'AI'|'Multiplayer';
  isMobile:boolean;
  board:any;
  onCellClick:(x:number,y:number)=>void;
  onLeave:()=>void;
  p1Name:string;
  p2Name:string;
  yourTurn?:boolean;
  midText?:string;
  glowSide?: 'red' | 'blue' | null;
  dimSide?: 'red' | 'blue' | null;
  overlay?: React.ReactNode;
  p1Avatar?: string;
  p2Avatar?: string;
}> = ({ modeName, isMobile, board, onCellClick, onLeave, p1Name, p2Name, yourTurn, midText, glowSide, dimSide, overlay, p1Avatar, p2Avatar })=>{
  const cell=40, DOT=Math.floor(cell*0.76), bw=8*cell, bh=8*cell;

  const lines:JSX.Element[]=[];
  const orderByAngle=(pts:Point[])=>{ const cx=(pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4, cy=(pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4; return pts.slice().sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx)); };
  const addLinesFading=(sqs:Square[], rgbVar:string)=>{ const n=sqs.length, minA=0.14, maxA=0.9;
    for(let idx=0; idx<n; idx++){ const sq=sqs[idx]; const a=n<=1?maxA:(minA+(idx/(n-1))*(maxA-minA));
      const ord=orderByAngle([sq.p1,sq.p2,sq.p3,sq.p4]).map(p=>({x:(p.x+0.5)*cell,y:(p.y+0.5)*cell}));
      for(let i=0;i<4;i++){ const j=(i+1)%4; lines.push(<line key={`${rgbVar}-${idx}-${i}`} x1={ord[i].x} y1={ord[i].y} x2={ord[j].x} y2={ord[j].y} stroke={`rgba(var(${rgbVar}), ${a})`} strokeWidth="2" />); }
    }
  };
  addLinesFading(board.m_players[0].m_squares,'--line-red'); addLinesFading(board.m_players[1].m_squares,'--line-blue');

  const leftGlow = glowSide==='red' ? 'red' : null;
  const rightGlow = glowSide==='blue' ? 'blue' : null;
  const leftDim  = dimSide==='red' ? .5 : 1;
  const rightDim = dimSide==='blue'? .5 : 1;

  return (
    <div className="flex flex.col justify.center items.center gap-4 p-4" style={{background:'var(--bg)', height:'100vh', overflow:'hidden'}}>
      {/* overlay (winner/notice) */}
      {overlay}
      <h1 className="text-2xl font.bold text.center" style={{color:'var(--text)'}}>Euclid</h1>

      {/* Scoreboard */}
      {!isMobile ? (
        <div className="w.full flex justify.between gap-4 items.start">
          <div className="flex-1 flex justify.start" style={{opacity:leftDim}}>
            <ScoreCard label={p1Name} score={board.m_players[0].m_score} align="left" glow={leftGlow} avatar={p1Avatar} />
          </div>
          <div className="flex flex.col items.center justify.start" style={{minWidth:260, color:'var(--text)'}}>
            <div style={{fontWeight:800}}>{midText}</div>
          </div>
          <div className="flex-1 flex justify.end" style={{opacity:rightDim}}>
            <ScoreCard label={p2Name} score={board.m_players[1].m_score} align="right" glow={rightGlow} avatar={p2Avatar} />
          </div>
        </div>
      ) : (
        <div className="w.full flex flex.col items.center gap-2">
          <div style={{opacity:leftDim}}>
            <ScoreCard label={p1Name} score={board.m_players[0].m_score} align="left" glow={leftGlow} avatar={p1Avatar} compact />
          </div>
          <div style={{color:'var(--text)', fontWeight:800}}>{midText}</div>
          <div style={{opacity:rightDim}}>
            <ScoreCard label={p2Name} score={board.m_players[1].m_score} align="right" glow={rightGlow} avatar={p2Avatar} compact />
          </div>
        </div>
      )}

      {/* Board */}
      <div className="relative" style={{width:bw, height:bh, margin:'0 auto', maxWidth:'100vw'}}>
        {/* Overlay lines — do not intercept clicks */}
        <svg className="absolute top-0 left-0 w.full h.full z-10" style={{ pointerEvents:'none' }} viewBox={`0 0 ${bw} ${bh}`}>{lines}</svg>

        <div className="grid" style={{gridTemplateColumns:`repeat(8, ${cell}px)`, gridAutoRows:`${cell}px`, gap:0}}>
          {Array.from({length:8},(_,y)=>
            Array.from({length:8},(_,x)=>{
              const v=board.m_board[y * 8 + x];
              const isLast = v>0 && board?.m_last && board.m_last.x===x && board.m_last.y===y;
              let fill='var(--empty-fill)', stroke='var(--empty-stroke)', shadow: string | undefined = undefined, extraClass = '';
              if(v===1){
                fill='var(--dot-red-fill)'; stroke='var(--dot-red-stroke)';
                if (isLast) { shadow = '0 0 0 5px var(--last-red-ring), 0 0 18px var(--last-red-glow)'; extraClass = 'last__pulse'; }
              }
              if(v===2){
                fill='var(--dot-blue-fill)'; stroke='var(--dot-blue-stroke)';
                if (isLast) { shadow = '0 0 0 5px var(--last-blue-ring), 0 0 18px var(--last-blue-glow)'; extraClass = 'last__pulse'; }
              }
              return (
                <div key={`${y}-${x}`} className="flex items.center justify.center" onClick={()=>onCellClick(x,y)}>
                  <div className={`rounded-full ${extraClass}`}
                    style={{ width:DOT, height:DOT, background:fill, border:`2px solid ${stroke}`, boxShadow: shadow }}
                    aria-label={isLast ? 'Last move' : undefined}
                    title={isLast ? 'Last move' : undefined}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Leave/Back */}
      <div className="flex gap-2 mt-2" style={{ marginBottom: isMobile ? 116 : 76 }}>
        <button className="rounded cursor.pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={onLeave}>
          {modeName==='Multiplayer' ? 'Leave Game' : 'Back'}
        </button>
      </div>
    </div>
  );
};

