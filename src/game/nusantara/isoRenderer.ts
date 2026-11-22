import {
  MAP_SIZE,
  TILE_H,
  TILE_W,
  type Direction,
  type FloorType,
  type HairStyle,
  type PlayerRole,
  type SchoolMapData,
} from './schoolMap';
import {
  drawCharacterSprite,
  drawWorldObject,
  toIso,
  type SpriteBubble,
  type SpriteEmote,
} from './isoSprites';

export { drawCharacterSprite, toIso };

export interface RenderPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  hairStyle?: HairStyle;
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

export type ChatBubble = SpriteBubble;
export type EmoteEffect = SpriteEmote;

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
