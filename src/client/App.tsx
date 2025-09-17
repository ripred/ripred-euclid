import React, { useEffect, useRef, useState } from 'react';
import { navigateTo } from '@devvit/web/client';
import { Devvit } from '@devvit/public-api';

/* ===== theme (light/dark aware) ===== */
const GlobalStyles = () => (
  <style>{`
    /* Light: default */
    :root{
      --bg: #f8fafc;
      --text: #0b1220;
      --muted: #4b5563;
      --card-bg: #ffffff;
      --card-border: #d1d5db;

      --empty-fill: #eef2f7;
      --empty-stroke: #94a3b8;

      --dot-red-stroke: #b91c1c;
      --dot-red-fill:   #fde2e2;
      --dot-blue-stroke:#1d4ed8;
      --dot-blue-fill:  #e0ecff;

      --line-red: 185, 28, 28;
      --line-blue: 29, 78, 216;

      --pill-red: rgba(185, 28, 28, .14);
      --pill-blue: rgba(29, 78, 216, .14);
    }

    /* Dark: match common host toggles */
    :root[data-theme="dark"],
    .dark,
    .theme-dark,
    [data-color-mode="dark"]{
      --bg: #0b1220;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --card-bg: #111827;
      --card-border: #374151;

      --empty-fill: #1f2937;
      --empty-stroke: #d1d5db;

      --dot-red-stroke: #ef4444;
      --dot-red-fill:   #7f1d1d;
      --dot-blue-stroke:#3b82f6;
      --dot-blue-fill:  #1e3a8a;

      --line-red: 252, 97, 97;
      --line-blue: 96, 165, 250;

      --pill-red: rgba(239, 68, 68, .20);
      --pill-blue: rgba(59, 130, 246, .20);
    }

    /* Fallback to OS theme if host doesn't set attributes */
    @media (prefers-color-scheme: dark){
      :root{
        --bg: #0b1220;
        --text: #f3f4f6;
        --muted: #9ca3af;
        --card-bg: #111827;
        --card-border: #374151;

        --empty-fill: #1f2937;
        --empty-stroke: #d1d5db;

        --dot-red-stroke: #ef4444;
        --dot-red-fill:   #7f1d1d;
        --dot-blue-stroke:#3b82f6;
        --dot-blue-fill:  #1e3a8a;

        --line-red: 252, 97, 97;
        --line-blue: 96, 165, 250;

        --pill-red: rgba(239, 68, 68, .20);
        --pill-blue: rgba(59, 130, 246, .20);
      }
    }

    /* Let the UA know we support both */
    body { color-scheme: light dark; }

    .glow-red { box-shadow: 0 0 0 3px rgba(239,68,68,.6), 0 0 18px rgba(239,68,68,.45); }
    .glow-blue{ box-shadow: 0 0 0 3px rgba(59,130,246,.6), 0 0 18px rgba(59,130,246,.45); }
    .anim__animated { animation-duration: .6s; animation-fill-mode: both; }
    @keyframes zoomIn_kf { from{opacity:0;transform:scale3d(.3,.3,.3);} 50%{opacity:1;} }
    .anim__zoomIn { animation-name: zoomIn_kf; }
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
  static PS_OFFENSIVE=1; static PS_DEFENSIVE=2; static PS_CASUAL=3;

  static WIDTH=8; static HEIGHT=8; static CELL_WIDTH=40; static CELL_HEIGHT=40;

  m_board:number[]=[]; m_players:Player[]=[]; m_turn=0; m_history:Point[]=[]; m_displayed_game_over=false;
  m_onlyShowLastSquares=false; m_createRandomizedRangeOrder=true; m_stopAt150=true;
  m_last:Point; m_lastPoints=0;

  constructor(p1:Player,p2:Player,skip=false){ this.m_players=[p1,p2]; this.m_last=new Point(-1,-1); if(!skip) this.initGame(); }
  initGame(){ this.m_board=new Array(Board.WIDTH*Board.HEIGHT).fill(0); this.m_history=[]; this.m_turn=0; this.m_displayed_game_over=false; this.m_last=new Point(-1,-1); this.m_players[0].initGame(); this.m_players[1].initGame(); }
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

  private scoreIfPlaced(pt:Point){ const clr=this.m_turn+1, saved=this.m_board[pt.index]; this.m_board[pt.index]=clr; let total=0; const x=pt.x,y=pt.y,other=clr===1?2:1;
    const rows=this.createRandomizedRange(Board.HEIGHT), cols=this.createRandomizedRange(Board.WIDTH);
    for(let index=0;index<Board.WIDTH*Board.HEIGHT;index++){
      const row=rows[Math.floor(index/Board.WIDTH)], col=cols[index%Board.WIDTH];
      const dx=col-x,dy=row-y,x1=x-dy,y1=y+dx,x2=col-dy,y2=row+dx;
      if(x1<0||x1>=Board.WIDTH||y1<0||y1>=Board.HEIGHT||x2<0||x2>=Board.WIDTH||y2<0||y2>=Board.HEIGHT||(col===x&&row===y)) continue;
      const v1=this.m_board[y*Board.WIDTH+x],v2=this.m_board[row*Board.WIDTH+col],v3=this.m_board[y1*Board.WIDTH+x1],v4=this.m_board[y2*Board.WIDTH+x2];
      if(v1===other||v2===other||v3===other||v4===other) continue;
      const remain=(v1===0?1:0)+(v2===0?1:0)+(v3===0?1:0)+(v4===0?1:0);
      if(remain===0){ const left=Math.min(x,col,x1,x2),top=Math.min(y,row,y1,y2),right=Math.max(x,col,x1,x2),bottom=Math.max(y,row,y1,y2); total+=(right-left+1)*(bottom-top+1); }
    } this.m_board[pt.index]=saved; return total; }

  private bestPotentialValueForMove(pt:Point){ const potentials:Square[]=[]; this.analyze(pt,potentials); let best=0; for(const s of potentials) if(s.points>best) best=s.points; return best; }

  private offensiveChoice(){ const rows=this.createRandomizedRange(Board.HEIGHT), cols=this.createRandomizedRange(Board.WIDTH), all:Square[]=[];
    for(let i=0;i<Board.WIDTH*Board.HEIGHT;i++){ const mv=this.pointAt(cols[i%Board.WIDTH],rows[Math.floor(i/Board.WIDTH)]); const cur:Square[]=[]; this.analyze(mv,cur); for(const s of cur) if(!all.some(t=>t.p1.index===s.p1.index&&t.p2.index===s.p2.index&&t.p3.index===s.p3.index&&t.p4.index===s.p4.index&&t.points===s.points&&t.remain===s.remain&&t.clr===s.clr)) all.push(s); }
    if(all.length===0){ let bestPt=this.pointAt(0,0),bestImm=-1,bestPot=-1;
      for(let i=0;i<this.m_board.length;i++){ if(this.m_board[i]!==0) continue; const pt=this.pointAt(i%Board.WIDTH,Math.floor(i/Board.WIDTH)); const imm=this.scoreIfPlaced(pt), pot=this.bestPotentialValueForMove(pt);
        if(imm>bestImm || (imm===bestImm && pot>bestPot)){ bestImm=imm; bestPot=pot; bestPt=pt; } }
      return { pt:bestPt, immediate:bestImm };
    }
    let maxPts=0; for(const s of all) if(s.points>maxPts) maxPts=s.points;
    const top=all.filter(s=>s.points===maxPts);
    let minRemain=Math.min(...top.map(s=>s.remain)); const cand=top.filter(s=>s.remain===minRemain);
    const s=cand[0];
    const remaining:Point[]=[]; if(this.m_board[s.p1.index]===0) remaining.push(s.p1); if(this.m_board[s.p2.index]===0) remaining.push(s.p2); if(this.m_board[s.p3.index]===0) remaining.push(s.p3); if(this.m_board[s.p4.index]===0) remaining.push(s.p4);
    let best=remaining[0], bestImm=-1;
    for(const r of remaining){ const imm=this.scoreIfPlaced(r); if(imm>bestImm){ bestImm=imm; best=r; } }
    return { pt:best, immediate:bestImm };
  }

  findBestMove(){
    const style=this.m_players[this.m_turn].m_playStyle;
    if(this.m_players[this.m_turn].m_goofs || style===Board.PS_CASUAL){
      if(Math.floor(Math.random()*(style===Board.PS_CASUAL?18:12))===1){
        let x=-1,y=-1; while(x<0||this.m_board[y*Board.WIDTH+x]>0){ x=Math.floor(Math.random()*Board.WIDTH); y=Math.floor(Math.random()*Board.HEIGHT); }
        return this.pointAt(x,y);
      }
    }
    const ours=this.offensiveChoice();
    if(style!==Board.PS_DEFENSIVE) return ours.pt;
    this.advanceTurn();
    const save = this.m_players[this.m_turn].m_playStyle;
    this.m_players[this.m_turn].m_playStyle=Board.PS_OFFENSIVE;
    let oppImm=-1, oppPt=this.pointAt(0,0);
    for(let i=0;i<this.m_board.length;i++){ if(this.m_board[i]!==0) continue; const pt=this.pointAt(i%Board.WIDTH,Math.floor(i/Board.WIDTH)); const imm=this.scoreIfPlaced(pt); if(imm>oppImm){ oppImm=imm; oppPt=pt; } }
    this.m_players[this.m_turn].m_playStyle=save;
    this.advanceTurn();
    if(oppImm>=ours.immediate) return oppPt;
    return ours.pt;
  }

  makeMove(){ const m=this.findBestMove(); this.placePiece(m); return m; }
  placePiece(pt:Point){ if(!pt.valid()||this.m_board[pt.index]>0) return 0; this.m_board[pt.index]=this.m_turn+1; this.m_history.push(pt); this.m_last=this.pointAt(pt.x,pt.y); const points=this.analyze(pt,null); this.m_players[this.m_turn].m_score+=points; return points; }
  advanceTurn(){ this.m_turn=(this.m_turn+1)%2; }
  checkGameOver(){ if(this.m_players[0].m_score>=150) return 1; if(this.m_players[1].m_score>=150) return 2; return 0; }
  toJSON(){ return { m_board:this.m_board, m_players:this.m_players, m_turn:this.m_turn, m_history:this.m_history, m_displayed_game_over:this.m_displayed_game_over, m_onlyShowLastSquares:this.m_onlyShowLastSquares, m_createRandomizedRangeOrder:this.m_createRandomizedRangeOrder, m_stopAt150:this.m_stopAt150, m_last:{x:this.m_last.x,y:this.m_last.y,index:this.m_last.index}, m_lastPoints:this.m_lastPoints, playerNames:(this as any).playerNames||{}, playerAvatars:(this as any).playerAvatars||{} }; }
  static fromJSON(j:any){ const b=new Board(new Player(1,false,j?.m_players?.[0]?.userId||''), new Player(1,false,j?.m_players?.[1]?.userId||''), true); b.m_board=j.m_board; b.m_players=j.m_players; b.m_turn=j.m_turn; b.m_history=(j.m_history||[]).map((p:any)=>new Point(p.x,p.y)); (b as any).playerNames=j.playerNames||{}; (b as any).playerAvatars=j.playerAvatars||{}; b.m_last=new Point(j.m_last?.x??-1,j.m_last?.y??-1); return b; }
  clone(){ return Board.fromJSON(this.toJSON()); }
}

/* ===== ScoreCard ===== */
const ScoreCard:React.FC<{
  label:string;
  score:number;
  align:'left'|'right';
  glow?: 'red' | 'blue' | null;
  avatar?: string;
  compact?: boolean;
}> =
({ label, score, align, glow=null, avatar, compact=false }) => {
  const width = compact ? 'clamp(160px, 44vw, 210px)' : 'clamp(200px, 42vw, 230px)';
  return (
    <div className={`flex flex-col ${align==='right'?'items-end':'items-start'}`}>
      <div
        className={`flex items-center justify-between px-3 py-1 rounded-md shadow-sm ${glow==='red'?'glow-red':''} ${glow==='blue'?'glow-blue':''}`}
        style={{width, background:'var(--card-bg)', border:`1px solid var(--card-border)`}}
      >
        <div className="flex items-center gap-2" style={{color:'var(--text)', minWidth:0}}>
          {avatar ? (
            <img src={avatar} alt="" style={{width:22,height:22,borderRadius:'50%'}}/>
          ) : (
            <span className="inline-block" style={{width:22,height:22,borderRadius:'50%',background:'var(--empty-stroke)'}}/>
          )}
          <span
            className="font-medium"
            style={{display:'inline-block', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis', maxWidth: compact ? 120 : 150}}
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="font-semibold" style={{color:'var(--text)'}}>{score}</span>
      </div>
    </div>
  );
};

/* ===== App ===== */
type Mode='ai'|'multiplayer'|'spectate'|null;

export const App=(context:Devvit.Context)=>{
  const [mode,setMode]=useState<Mode>(null);
  const [board,setBoard]=useState<Board|null>(null);
  const [selectedStyle,setSelectedStyle]=useState(Board.PS_OFFENSIVE);
  const [status,setStatus]=useState<string>('');
  const [winner,setWinner]=useState<number|null>(null);
  const [finalSide,setFinalSide]=useState<number|null>(null);
  const [finalReason,setFinalReason]=useState<string>('');
  const [isMobile,setIsMobile]=useState(false);
  const [notice,setNotice]=useState<string>('');

  useEffect(()=>{ const onResize=()=>setIsMobile(typeof window!=='undefined'&&window.innerWidth<=768); onResize(); window.addEventListener('resize',onResize); return()=>window.removeEventListener('resize',onResize);},[]);
  useEffect(()=>{ (async()=>{ try{ await fetch('/api/init'); }catch{} })(); },[]);

  // H2H
  const [gameId,setGameId]=useState<string|null>(null);
  const gameIdRef = useRef<string|null>(null);
  const [isPlayer1,setIsPlayer1]=useState<boolean>(false);
  const [spectating,setSpectating]=useState<boolean>(false);
  const pollRef=useRef<number|null>(null);
  const stopPolling=()=>{ if(pollRef.current){ clearInterval(pollRef.current); pollRef.current=null; } };

  const refreshStateOnce = async () => {
    const gid = gameIdRef.current; if(!gid) return;
    try{
      const r=await fetch(`/api/h2h/state?gameId=${encodeURIComponent(gid)}`);
      if (r.status === 410) { setNotice('Game ended (stale or cleared).'); stopPolling(); return; }
      const j=await r.json();
      if (j.ended) {
        let side = j.victorSide ?? null;
        if (!side && j.board) {
          const s1=j.board.m_players?.[0]?.m_score??0, s2=j.board.m_players?.[1]?.m_score??0;
          side = s1>=s2 ? 1 : 2;
        }
        setFinalSide(side);
        setFinalReason(j.endedReason||'game_over');
        stopPolling();
      }
      if(j.board) setBoard(Board.fromJSON(j.board));
    }catch{}
  };

  const pollGame = () => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const gid = gameIdRef.current; if (!gid) return;
      try {
        const r=await fetch(`/api/h2h/state?gameId=${encodeURIComponent(gid)}`);
        if (r.status === 410) { setNotice('Game ended (stale or cleared).'); stopPolling(); return; }
        const j=await r.json();
        if (j.ended) {
          let side = j.victorSide ?? null;
          if (!side && j.board) {
            const s1=j.board.m_players?.[0]?.m_score??0, s2=j.board.m_players?.[1]?.m_score??0;
            side = s1>=s2 ? 1 : 2;
          }
          setFinalSide(side);
          setFinalReason(j.endedReason||'game_over');
          stopPolling();
        }
        if(j.board) setBoard(Board.fromJSON(j.board));
      } catch {}
    }, 1000) as unknown as number;
  };

  const pollMapping = () => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch('/api/h2h/mapping');
        const j = await r.json();
        if (j.gameId) {
          setGameId(j.gameId); gameIdRef.current = j.gameId;
          if (typeof j.isPlayer1 === 'boolean') setIsPlayer1(j.isPlayer1);
          if (j.board) {
            setBoard(Board.fromJSON(j.board));
            setSpectating(false);
            setMode('multiplayer'); setStatus(''); setNotice(''); setFinalSide(null); setFinalReason('');
            stopPolling(); pollGame();
          }
        }
      } catch {}
    }, 1000) as unknown as number;
  };

  const leaveMultiplayer=async()=>{
    try{ await fetch('/api/h2h/leave',{method:'POST'}); }catch{}
    stopPolling();
    setGameId(null); gameIdRef.current=null;
    setIsPlayer1(false);
    setSpectating(false);
    setBoard(null);
    setMode(null);
    setStatus(''); setNotice('');
    setWinner(null); setFinalSide(null); setFinalReason('');
  };

  /* ===== Spectate list ===== */
  const [games,setGames]=useState<{gameId:string; names:Record<string,string>; scores:number[]; lastSaved:number; ended:boolean}[]>([]);
  const loadGames = async () => { try { const r=await fetch('/api/games/list'); const j=await r.json(); setGames(j.games||[]); } catch {} };

  /* ===== Intro ===== */
  if(mode===null){
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-6" style={{background:'var(--bg)'}}>
        <GlobalStyles />
        <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid</h1>

        <div className="flex flex-col items-center gap-2">
          <label className="font-medium" style={{color:'var(--muted)'}}>AI Style</label>
          <select className="rounded px-4 py-2" style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`}} value={selectedStyle} onChange={(e)=>setSelectedStyle(Number(e.target.value))}>
            <option value={Board.PS_OFFENSIVE}>Offensive</option>
            <option value={Board.PS_DEFENSIVE}>Defensive</option>
            <option value={Board.PS_CASUAL}>Casual</option>
          </select>
        </div>

        <div className="flex gap-3">
          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'8px 16px'}}
            onClick={()=>{ const p1=new Player(selectedStyle,false); const p2=new Player(selectedStyle,true); const b=new Board(p1,p2); setBoard(b); setWinner(null); setMode('ai'); }}>
            Play vs AI
          </button>

          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{
              setStatus('Queuing…');
              try{
                const r=await fetch('/api/h2h/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                const text=await r.text(); const j=JSON.parse(text);
                if(j.paired && j.gameId && j.board){
                  setGameId(j.gameId); gameIdRef.current=j.gameId;
                  if(typeof j.isPlayer1==='boolean') setIsPlayer1(j.isPlayer1);
                  setSpectating(false);
                  setBoard(Board.fromJSON(j.board));
                  setMode('multiplayer'); setStatus(''); setNotice(''); setFinalSide(null); setFinalReason(''); pollGame();
                } else {
                  setSpectating(false);
                  setMode('multiplayer'); setStatus('Waiting for opponent…'); pollMapping();
                }
              }catch(e:any){ setStatus('Queue failed: '+(e?.message||e)); }
            }}>
            Play vs Human
          </button>

          <button className="rounded cursor-pointer" style={{background:'#374151', color:'#fff', padding:'8px 16px'}}
            onClick={async()=>{ await loadGames(); setMode('spectate'); }}>
            Spectate
          </button>
        </div>

        {status && <div className="text-sm" style={{color:'var(--muted)'}}>{status}</div>}
      </div>
    );
  }

  /* ===== Spectate ===== */
  if(mode==='spectate'){
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-4" style={{background:'var(--bg)'}}>
        <GlobalStyles />
        <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid — Spectate</h1>
        <div className="w-[min(640px,92vw)] flex flex-col gap-2" style={{color:'var(--text)'}}>
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
                      setSpectating(true);
                      pollGame();
                      setMode('multiplayer');
                      setStatus('Spectating — read only');
                    }}>Watch</button>
                </div>
              </div>
            );
          })}
        </div>
        <button className="rounded cursor-pointer" style={{background:'#6b7280', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); }}>
          Back
        </button>
      </div>
    );
  }

  /* ===== Multiplayer ===== */
  if(mode==='multiplayer'){
    if(!board){
      return (
        <div className="flex flex-col justify-center items-center min-h-screen gap-5" style={{background:'var(--bg)'}}>
          <GlobalStyles />
          <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid</h1>
          <div className="text-sm" style={{color:'var(--muted)'}}>{status || 'Waiting for opponent…'}</div>
          <button className="rounded cursor-pointer" style={{background:'#6b7280', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); setStatus(''); }}>
            Back
          </button>
        </div>
      );
    }

    const p1Id=(board as any).m_players?.[0]?.userId||'';
    const p2Id=(board as any).m_players?.[1]?.userId||'';
    const names=(board as any).playerNames||{};
    const avatars=(board as any).playerAvatars||{};
    const p1Name=names[p1Id]||'Red';
    const p2Name=names[p2Id]||'Blue';

    const isMyTurn=(board.m_turn===0)===isPlayer1;

    const onCellClick=async(x:number,y:number)=>{
      const gid = gameIdRef.current;
      if(!board||!gid) return;
      if(spectating) return;
      if(!isMyTurn || board.m_board[y*Board.WIDTH+x]>0 || winner || finalSide) return;

      const move=board.pointAt(x,y);
      board.placePiece(move);
      const st=board.checkGameOver();
      if(st!==0){ setWinner(st); }
      else { board.advanceTurn(); }

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

    const decideWinnerSide = () => {
      if (finalSide) return finalSide;
      if (winner) return winner;
      return null;
    };
    const decided = decideWinnerSide();
    const showWinner = !!decided;
    const winnerLabel = decided===1 ? p1Name : p2Name;
    const youAreWinner = (decided===1 && isPlayer1) || (decided===2 && !isPlayer1);
    const winnerText = youAreWinner ? 'You win!' : `${winnerLabel} wins!`;

    const overlay = (notice || showWinner) ? (
      <div className="anim__animated anim__zoomIn"
           style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, background:'rgba(0,0,0,.55)'}}>
        <div style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`, borderRadius:12, padding:'16px 22px', textAlign:'center', maxWidth:520}}>
          {showWinner ? (
            <>
              <div style={{fontSize:'1.2rem', fontWeight:800, marginBottom:8}}>{winnerText}</div>
              <div style={{color:'var(--muted)', marginBottom:12}}>Final: {p1Name} {board.m_players[0].m_score} — {board.m_players[1].m_score} {p2Name}</div>
            </>
          ) : (
            <div style={{fontSize:'1.1rem', fontWeight:800, marginBottom:8}}>{notice}</div>
          )}
          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setMode(null); setBoard(null); setStatus(''); setNotice(''); setWinner(null); setFinalSide(null); setFinalReason(''); }}>
            Close
          </button>
        </div>
      </div>
    ) : null;

    return (
      <GameScreen
        modeName="Multiplayer"
        isMobile={isMobile}
        board={board}
        onCellClick={onCellClick}
        onLeave={leaveMultiplayer}
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
  if(mode==='ai'){
    if(!board) return <div>Loading...</div>;

    const p1Name='You';
    const p2Name= selectedStyle===Board.PS_OFFENSIVE ? 'Bot (Offensive)'
                 : selectedStyle===Board.PS_DEFENSIVE ? 'Bot (Defensive)'
                 : 'Bot (Casual)';

    const onCellClick=(x:number,y:number)=>{
      if(board.m_turn!==0 || board.m_board[y*Board.WIDTH+x]>0 || winner) return;
      const move=board.pointAt(x,y);
      board.placePiece(move);
      const st=board.checkGameOver();
      if(st!==0){ setWinner(st); setBoard(board.clone()); return; }
      board.advanceTurn();
      setTimeout(()=>{
        board.m_players[1].m_playStyle = selectedStyle;
        board.makeMove();
        const st2=board.checkGameOver();
        if(st2!==0) setWinner(st2);
        else board.advanceTurn();
        setBoard(board.clone());
      }, 1000);
      setBoard(board.clone());
    };

    const midText = winner ? ((winner===1?'You':'Bot') + ' win!') : (board.m_turn===0 ? 'Your move' : 'Waiting on Bot…');

    const overlay = winner ? (
      <div className="anim__animated anim__zoomIn"
           style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, background:'rgba(0,0,0,.55)'}}>
        <div style={{background:'var(--card-bg)', color:'var(--text)', border:`1px solid var(--card-border)`, borderRadius:12, padding:'16px 22px', textAlign:'center'}}>
          <div style={{fontSize:'1.2rem', fontWeight:800, marginBottom:8}}>{winner===1?'You win!':'Bot wins!'}</div>
          <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={()=>{ setWinner(null); setBoard(null); setMode(null); setStatus(''); setNotice(''); }}>
            Close
          </button>
        </div>
      </div>
    ) : null;

    return (
      <GameScreen
        modeName="AI"
        isMobile={isMobile}
        board={board}
        onCellClick={onCellClick}
        onLeave={()=>{ setWinner(null); setBoard(null); setMode(null); setStatus(''); setNotice(''); }}
        p1Name={p1Name}
        p2Name={p2Name}
        yourTurn={board.m_turn===0}
        midText={midText}
        glowSide={winner ? null : (board.m_turn===0 ? 'red' : 'blue')}
        dimSide={winner ? null : (board.m_turn===0 ? 'blue' : 'red')}
        overlay={overlay}
      />
    );
  }

  return null;
};

/* ===== Screen ===== */
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
      const ordered=orderByAngle([sq.p1,sq.p2,sq.p3,sq.p4]).map(p=>({x:(p.x+0.5)*cell,y:(p.y+0.5)*cell}));
      for(let i=0;i<4;i++){ const j=(i+1)%4; lines.push(<line key={`${rgbVar}-${idx}-${i}`} x1={ordered[i].x} y1={ordered[i].y} x2={ordered[j].x} y2={ordered[j].y} stroke={`rgba(var(${rgbVar}), ${a})`} strokeWidth="2" />); }
    }
  };
  addLinesFading(board.m_players[0].m_squares,'--line-red');
  addLinesFading(board.m_players[1].m_squares,'--line-blue');

  const leftGlow = glowSide==='red' ? 'red' : null;
  const rightGlow = glowSide==='blue' ? 'blue' : null;
  const leftDim  = dimSide==='red' ? .5 : 1;
  const rightDim = dimSide==='blue'? .5 : 1;

  return (
    <div className="flex flex-col justify-center items-center min-h-screen gap-4 p-4" style={{background:'var(--bg)'}}>
      <GlobalStyles />
      {overlay}
      <h1 className="text-2xl font-bold text-center" style={{color:'var(--text)'}}>Euclid</h1>

      {/* Scoreboard */}
      {!isMobile ? (
        <div className="w-full flex justify-between gap-4 items-start">
          <div className="flex-1 flex justify-start" style={{opacity:leftDim}}>
            <ScoreCard label={p1Name} score={board.m_players[0].m_score} align="left" glow={leftGlow} avatar={p1Avatar} />
          </div>
          <div className="flex flex-col items-center justify-start" style={{minWidth:260, color:'var(--text)'}}>
            <div style={{fontWeight:800}}>{midText}</div>
          </div>
          <div className="flex-1 flex justify-end" style={{opacity:rightDim}}>
            <ScoreCard label={p2Name} score={board.m_players[1].m_score} align="right" glow={rightGlow} avatar={p2Avatar} />
          </div>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-2">
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
      <div className="relative" style={{width:bw, height:bh, margin:'0 auto'}}>
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10" viewBox={`0 0 ${bw} ${bh}`}>{lines}</svg>

        <div className="grid" style={{gridTemplateColumns:`repeat(8, ${cell}px)`, gridAutoRows:`${cell}px`, gap:0}}>
          {Array.from({length:8},(_,y)=>
            Array.from({length:8},(_,x)=>{
              const v=board.m_board[y * 8 + x];
              let fill='var(--empty-fill)', stroke='var(--empty-stroke)';
              if(v===1){ fill='var(--dot-red-fill)'; stroke='var(--dot-red-stroke)'; }
              if(v===2){ fill='var(--dot-blue-fill)'; stroke='var(--dot-blue-stroke)'; }
              return (
                <div key={`${y}-${x}`} className="flex items-center justify-center" onClick={()=>onCellClick(x,y)}>
                  <div className="rounded-full" style={{width:DOT, height:DOT, background:fill, border:`2px solid ${stroke}`}} />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Spaced above footer to avoid overlap on mobile */}
      <div className="flex gap-2 mt-2" style={{ marginBottom: isMobile ? 96 : 56 }}>
        <button className="rounded cursor-pointer" style={{background:'#d93900', color:'#fff', padding:'6px 12px'}} onClick={onLeave}>
          {modeName==='Multiplayer' ? 'Leave Game' : 'Back'}
        </button>
      </div>

      <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 text-[0.9em]" style={{color:'var(--muted)'}}>
        <button className="cursor-pointer" onClick={()=>navigateTo('https://developers.reddit.com/docs')}>Docs</button>
        <span>|</span>
        <button className="cursor-pointer" onClick={()=>navigateTo('https://www.reddit.com/r/Devvit')}>r/Devvit</button>
        <span>|</span>
        <button className="cursor-pointer" onClick={()=>navigateTo('https://discord.com/invite/R7yu2wh9Qz')}>Discord</button>
      </footer>
    </div>
  );
};

