import {
  MAP_SIZE,
  TILE_H,
  TILE_W,
  type Direction,
  type FloorType,
  type ObjectType,
  type PlayerRole,
  type SchoolMapData,
} from './schoolMap';

export interface RenderPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  hairColor: string;
  skinColor: string;
  wx: number;
  wy: number;
  renderWx: number;
  renderWy: number;
  dir: Direction;
  moving: boolean;
  sprinting: boolean;
  sitting: boolean;
  jumpOffset: number;
  walkPhase: number;
}

export interface ChatBubble {
  text: string;
  expires: number;
}

export interface EmoteEffect {
  emoji: string;
  expires: number;
}

export interface WorldEffect {
  type: 'ball';
  wx: number;
  wy: number;
  targetWx: number;
  targetWy: number;
  progress: number;
  scored?: boolean;
}

export interface MoveTarget {
  wx: number;
  wy: number;
  createdAt: number;
}

export function toIso(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - wy) * (TILE_W / 2),
    y: (wx + wy) * (TILE_H / 2),
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  camX: number,
  camY: number,
  zoom: number,
  viewW: number,
  viewH: number
): { wx: number; wy: number } {
  const isoX = (screenX - viewW / 2) / zoom + viewW / 2 + camX;
  const isoY = (screenY - viewH / 2) / zoom + viewH / 2 + camY;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const wx = (isoX / hw + isoY / hh) / 2;
  const wy = (isoY / hh - isoX / hw) / 2;
  return { wx, wy };
}

const FLOOR_COLORS: Record<FloorType, [string, string]> = {
  grass: ['#4ade80', '#34d399'],
  paving: ['#cbd5e1', '#b4c0d0'],
  corridor: ['#fef3c7', '#fde68a'],
  class_floor: ['#f8fafc', '#e2e8f0'],
  lib_floor: ['#e7c39c', '#dcb388'],
  kantin_floor: ['#e0f2fe', '#bae6fd'],
  court: ['#ea580c', '#dc4e09'],
  court_key: ['#0ea5e9', '#0284c7'],
};

function drawIsoTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  colorTop: string,
  strokeColor = 'rgba(15,23,42,0.08)'
) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + TILE_W / 2, cy + TILE_H / 2);
  ctx.lineTo(cx, cy + TILE_H);
  ctx.lineTo(cx - TILE_W / 2, cy + TILE_H / 2);
  ctx.closePath();
  ctx.fillStyle = colorTop;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  wRatio: number,
  hPx: number,
  colTop: string,
  colLeft: string,
  colRight: string
) {
  const hw = (TILE_W / 2) * wRatio;
  const hh = (TILE_H / 2) * wRatio;
  const topY = cy + (TILE_H / 2) * (1 - wRatio);

  // Top face
  ctx.beginPath();
  ctx.moveTo(cx, topY - hPx);
  ctx.lineTo(cx + hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx - hw, topY + hh - hPx);
  ctx.closePath();
  ctx.fillStyle = colTop;
  ctx.fill();

  // Left face
  ctx.beginPath();
  ctx.moveTo(cx - hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx, topY + hh * 2);
  ctx.lineTo(cx - hw, topY + hh);
  ctx.closePath();
  ctx.fillStyle = colLeft;
  ctx.fill();

  // Right face
  ctx.beginPath();
  ctx.moveTo(cx + hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx, topY + hh * 2);
  ctx.lineTo(cx + hw, topY + hh);
  ctx.closePath();
  ctx.fillStyle = colRight;
  ctx.fill();
}

function drawWorldObject(
  ctx: CanvasRenderingContext2D,
  type: ObjectType,
  tx: number,
  ty: number,
  camX: number,
  camY: number,
  now: number
) {
  const pos = toIso(tx, ty);
  const sx = pos.x - camX;
  const sy = pos.y - camY;

  switch (type) {
    case 'wall':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      break;
    case 'window_wall':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      // Window pane accent
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(sx - 12, sy - 22, 10, 14);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx + 2, sy - 22, 10, 14);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx - 12, sy - 22, 10, 14);
      ctx.strokeRect(sx + 2, sy - 22, 10, 14);
      break;
    case 'brick_wall':
      drawIsoBox(ctx, sx, sy, 1, 34, '#fca5a5', '#dc2626', '#991b1b');
      break;
    case 'gate':
      drawIsoBox(ctx, sx, sy, 0.92, 62, '#f1f5f9', '#64748b', '#475569');
      drawIsoBox(ctx, sx, sy - 62, 1.02, 6, '#fbbf24', '#d97706', '#b45309');
      if (tx === 13) {
        ctx.font = 'bold 10px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(sx - 2, sy - 58, 128, 16);
        ctx.fillStyle = '#fef08a';
        ctx.fillText('SMA NUSANTARA', sx + 62, sy - 46);
      }
      break;
    case 'board':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      ctx.fillStyle = '#065f46';
      ctx.fillRect(sx - 16, sy - 22, 32, 20);
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 16, sy - 22, 32, 20);
      // Chalk lines
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(sx - 11, sy - 16, 18, 2);
      ctx.fillRect(sx - 11, sy - 11, 12, 2);
      break;
    case 'desk':
      drawIsoBox(ctx, sx, sy, 0.74, 16, '#d97706', '#b45309', '#78350f');
      // Open notebook on desk
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sx - 6, sy - 4, 11, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx - 5, sy - 3, 4, 5);
      break;
    case 'chair':
      drawIsoBox(ctx, sx, sy, 0.44, 9, '#38bdf8', '#0284c7', '#0369a1');
      break;
    case 'bench':
      drawIsoBox(ctx, sx, sy, 0.84, 10, '#a16207', '#854d0e', '#713f12');
      break;
    case 'podium':
      drawIsoBox(ctx, sx, sy, 0.7, 18, '#b45309', '#92400e', '#78350f');
      break;
    case 'locker':
      drawIsoBox(ctx, sx, sy, 0.75, 40, '#60a5fa', '#2563eb', '#1d4ed8');
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(sx - 8, sy - 18, 6, 3);
      ctx.fillRect(sx + 2, sy - 18, 6, 3);
      break;
    case 'bookshelf':
      drawIsoBox(ctx, sx, sy, 0.85, 40, '#92400e', '#78350f', '#451a03');
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(sx - 11, sy - 18, 5, 9);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(sx - 5, sy - 18, 5, 9);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(sx + 1, sy - 18, 5, 9);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(sx + 7, sy - 18, 4, 9);
      break;
    case 'stall':
      drawIsoBox(ctx, sx, sy, 0.9, 28, '#fef08a', '#f97316', '#c2410c');
      drawIsoBox(ctx, sx, sy - 27, 0.96, 8, '#ef4444', '#dc2626', '#991b1b');
      // White stripe awning accent
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 14, sy - 21, 6, 5);
      ctx.fillRect(sx + 4, sy - 21, 6, 5);
      break;
    case 'tree':
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 16, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      drawIsoBox(ctx, sx, sy, 0.3, 24, '#78350f', '#451a03', '#290d02');
      drawIsoBox(ctx, sx, sy - 22, 0.88, 22, '#4ade80', '#16a34a', '#15803d');
      drawIsoBox(ctx, sx, sy - 40, 0.56, 16, '#86efac', '#22c55e', '#16a34a');
      break;
    case 'flower': {
      drawIsoBox(ctx, sx, sy, 0.6, 7, '#22c55e', '#15803d', '#166534');
      const bloomCols = ['#f43f5e', '#fbbf24', '#ec4899'];
      ctx.fillStyle = bloomCols[(tx + ty) % bloomCols.length];
      ctx.beginPath();
      ctx.arc(sx - 5, sy + 4, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy + 6, 3, 0, Math.PI * 2);
      ctx.arc(sx, sy + 1, 2.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hoop':
      drawIsoBox(ctx, sx, sy, 0.24, 60, '#e2e8f0', '#64748b', '#475569');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 15, sy - 60, 30, 19);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 7, sy - 52, 14, 9);
      // Orange hoop ring
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 41, 7, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'flagpole': {
      drawIsoBox(ctx, sx, sy, 0.52, 7, '#e2e8f0', '#94a3b8', '#64748b');
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy + 10);
      ctx.lineTo(sx, sy - 88);
      ctx.stroke();
      const wave = Math.sin(now / 220) * 2.5;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(sx + 1, sy - 87 + wave * 0.3, 28, 9.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx + 1, sy - 77.5 + wave * 0.3, 28, 9.5);
      break;
    }
  }
}

export function drawCharacterSprite(
  ctx: CanvasRenderingContext2D,
  p: {
    id: string;
    name: string;
    role: PlayerRole;
    hairColor: string;
    skinColor: string;
    dir: Direction;
    moving: boolean;
    sitting: boolean;
    jumpOffset: number;
    walkPhase: number;
  },
  sx: number,
  syBase: number,
  isSelf: boolean,
  bubble?: ChatBubble,
  emote?: EmoteEffect,
  now = performance.now(),
  showTag = true
) {
  const sy = syBase - (p.jumpOffset || 0) - (p.sitting ? -4 : 0);

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(sx, syBase + 2, 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  let shirt = '#ffffff';
  let pants = '#64748b';
  if (p.role === 'smp') {
    shirt = '#ffffff';
    pants = '#1d4ed8';
  } else if (p.role === 'osis') {
    shirt = '#1e3a8a';
    pants = '#334155';
  } else if (p.role === 'guru') {
    shirt = '#b45309';
    pants = '#1e293b';
  }

  const legSwing = p.moving ? Math.sin(p.walkPhase) * 4.5 : 0;
  const armSwing = p.moving ? Math.cos(p.walkPhase) * 3.5 : 0;

  // Legs
  if (!p.sitting) {
    ctx.fillStyle = pants;
    ctx.fillRect(sx - 6, sy - 14 + legSwing, 5, 14);
    ctx.fillRect(sx + 1, sy - 14 - legSwing, 5, 14);
    // Shoes
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sx - 6, sy - 2 + legSwing, 5, 3);
    ctx.fillRect(sx + 1, sy - 2 - legSwing, 5, 3);
  } else {
    ctx.fillStyle = pants;
    ctx.fillRect(sx - 7, sy - 10, 14, 8);
  }

  // Arms
  ctx.fillStyle = shirt;
  ctx.fillRect(sx - 11, sy - 29 - armSwing, 3.5, 13);
  ctx.fillRect(sx + 7.5, sy - 29 + armSwing, 3.5, 13);

  // Torso
  ctx.fillStyle = shirt;
  ctx.fillRect(sx - 8, sy - 31, 16, 18);

  // Tie or Batik accent
  if (p.role === 'sma' || p.role === 'smp') {
    if (p.dir !== 'n') {
      ctx.fillStyle = p.role === 'sma' ? '#64748b' : '#1d4ed8';
      ctx.fillRect(sx - 1.5, sy - 29, 3, 10);
    }
  } else if (p.role === 'osis') {
    if (p.dir !== 'n') {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sx - 2, sy - 30, 4, 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(sx + 3, sy - 26, 2.5, 2.5);
    }
  } else if (p.role === 'guru') {
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(sx - 5, sy - 27, 2, 2);
    ctx.fillRect(sx + 2, sy - 23, 2, 2);
    ctx.fillRect(sx - 3, sy - 19, 2, 2);
  }

  // Head
  ctx.fillStyle = p.skinColor || '#f6d198';
  ctx.beginPath();
  ctx.arc(sx, sy - 39, 9.5, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = p.hairColor || '#1e293b';
  if (p.dir === 'n') {
    ctx.beginPath();
    ctx.arc(sx, sy - 40, 10, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(sx, sy - 42, 10, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(sx - 9.5, sy - 42, 3, 5);
    ctx.fillRect(sx + 6.5, sy - 42, 3, 5);
  }

  // Eyes
  if (p.dir !== 'n') {
    ctx.fillStyle = '#0f172a';
    const eyeOffX = p.dir === 'e' ? 3 : p.dir === 'w' ? -3 : 0;
    ctx.fillRect(sx - 3.5 + eyeOffX, sy - 39, 2.2, 2.5);
    ctx.fillRect(sx + 1.5 + eyeOffX, sy - 39, 2.2, 2.5);
  }

  if (!showTag) return;

  // Nametag
  ctx.font = '600 11px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  const tagText = p.role === 'guru' ? `Guru · ${p.name}` : p.name;
  const tagW = ctx.measureText(tagText).width + 12;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(sx - tagW / 2, sy - 67, tagW, 17, 4);
  ctx.fill();
  ctx.fillStyle = isSelf ? '#38bdf8' : '#f8fafc';
  ctx.fillText(tagText, sx, sy - 54.5);

  // Floating Emote
  if (emote && emote.expires > now) {
    ctx.font = '20px sans-serif';
    ctx.fillText(emote.emoji, sx, sy - 76);
  }

  // Speech Bubble
  if (bubble && bubble.expires > now) {
    ctx.font = '500 12px "DM Sans", sans-serif';
    const clipped = bubble.text.length > 30 ? `${bubble.text.slice(0, 29)}…` : bubble.text;
    const bw = Math.min(200, ctx.measureText(clipped).width + 18);
    const by = sy - 88;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(sx - bw / 2, by - 16, bw, 23, 6);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillText(clipped, sx, by - 0.5);
  }
}

export function renderSchoolScene(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  map: SchoolMapData;
  players: Record<string, RenderPlayer>;
  selfId: string | null;
  camX: number;
  camY: number;
  zoom: number;
  chatBubbles: Record<string, ChatBubble>;
  emotes: Record<string, EmoteEffect>;
  worldEffects: WorldEffect[];
  moveTarget: MoveTarget | null;
  ambientTint: string;
}) {
  const {
    ctx,
    width,
    height,
    map,
    players,
    selfId,
    camX,
    camY,
    zoom,
    chatBubbles,
    emotes,
    worldEffects,
    moveTarget,
    ambientTint,
  } = params;

  const now = performance.now();

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-width / 2, -height / 2);

  // Layer 1: Isometric Floor Tiles
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const pos = toIso(x, y);
      const sx = pos.x - camX;
      const sy = pos.y - camY;
      // Generous frustum culling
      if (
        sx < -TILE_W * 2 ||
        sx > width / zoom + TILE_W * 2 ||
        sy < -TILE_H * 2 ||
        sy > height / zoom + TILE_H * 2
      ) {
        continue;
      }

      const floorType = map.floor[y][x];
      const pal = FLOOR_COLORS[floorType] || FLOOR_COLORS.grass;
      const col = (x + y) % 2 === 0 ? pal[0] : pal[1];
      drawIsoTile(ctx, sx, sy, col);

      // Court center circle highlight
      if (x === 25 && (y === 20 || y === 21)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(sx, sy + TILE_H / 2, 16, 8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Click-to-move destination indicator
  if (moveTarget) {
    const pos = toIso(moveTarget.wx, moveTarget.wy);
    const sx = pos.x - camX;
    const sy = pos.y - camY;
    const pulse = ((now - moveTarget.createdAt) % 900) / 900;
    ctx.strokeStyle = `rgba(56, 189, 248, ${1 - pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 8 + pulse * 10, 4 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Layer 2: Depth-sorted Objects & Players
  const renderList: { depth: number; draw: () => void }[] = [];

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const obj = map.objects[y][x];
      if (obj) {
        renderList.push({
          depth: x + y + 1,
          draw: () => drawWorldObject(ctx, obj, x, y, camX, camY, now),
        });
      }
    }
  }

  Object.values(players).forEach((p) => {
    renderList.push({
      depth: p.renderWx + p.renderWy + 0.15,
      draw: () => {
        const pos = toIso(p.renderWx, p.renderWy);
        drawCharacterSprite(
          ctx,
          p,
          pos.x - camX,
          pos.y - camY,
          p.id === selfId,
          chatBubbles[p.id],
          emotes[p.id],
          now,
          true
        );
      },
    });
  });

  renderList.sort((a, b) => a.depth - b.depth);
  renderList.forEach((item) => item.draw());

  // Layer 3: World Effects (Basketball arcs)
  worldEffects.forEach((ef) => {
    if (ef.type === 'ball') {
      const wx = ef.wx + (ef.targetWx - ef.wx) * ef.progress;
      const wy = ef.wy + (ef.targetWy - ef.wy) * ef.progress;
      const arc = Math.sin(ef.progress * Math.PI) * 80;
      const pos = toIso(wx, wy);
      const bx = pos.x - camX;
      const by = pos.y - camY - 26 - arc;

      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#431407';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  ctx.restore();

  // Subtle schedule ambient tint
  if (ambientTint && ambientTint !== 'rgba(255, 255, 255, 0)') {
    ctx.fillStyle = ambientTint;
    ctx.fillRect(0, 0, width, height);
  }
}

export function renderMinimap(
  miniCtx: CanvasRenderingContext2D,
  map: SchoolMapData,
  players: Record<string, RenderPlayer>,
  selfId: string | null
) {
  const s = 4; // 32 * 4 = 128px
  miniCtx.clearRect(0, 0, 128, 128);

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const obj = map.objects[y][x];
      if (obj === 'wall' || obj === 'window_wall' || obj === 'brick_wall') {
        miniCtx.fillStyle = '#475569';
      } else {
        const pal = FLOOR_COLORS[map.floor[y][x]] || FLOOR_COLORS.grass;
        miniCtx.fillStyle = pal[0];
      }
      miniCtx.fillRect(x * s, y * s, s, s);
    }
  }

  Object.values(players).forEach((p) => {
    miniCtx.fillStyle = p.id === selfId ? '#ef4444' : '#ffffff';
    miniCtx.beginPath();
    miniCtx.arc(p.renderWx * s, p.renderWy * s, p.id === selfId ? 3.2 : 2.2, 0, Math.PI * 2);
    miniCtx.fill();
  });
}
