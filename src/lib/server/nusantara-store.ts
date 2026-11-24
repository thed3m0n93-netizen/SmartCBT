/**
 * SmartCBT — Nusantara High persistence & class-profile repository.
 *
 * Isolates all SQL reads/writes for `game_nusantara_state` and `student_profiles`
 * lookup so room/socket logic stays clean and testable.
 */

import { getDbType, isMySqlLike } from "../db.js";
import { query, queryOne } from "./utils.js";
import type { PlayerState } from "../../game/nusantara/schoolMap.js";
import type { StudentClassProfileRow } from "./nusantara-rooms.js";

export interface GameStateRow {
  xp: number | string;
  money: number | string;
  wx: number | string | null;
  wy: number | string | null;
  dir: string | null;
  uniform: string | null;
  hair_style: string | null;
  hair_color: string | null;
  skin_color: string | null;
}

let gameTableReady: Promise<void> | null = null;

export function ensureGameTable(): Promise<void> {
  if (!gameTableReady) {
    gameTableReady = (async () => {
      const mysql = isMySqlLike(getDbType());
      const ddl = mysql
        ? `CREATE TABLE IF NOT EXISTS game_nusantara_state (
             user_id    CHAR(36)     NOT NULL,
             class_id   BIGINT       NULL,
             xp         INT          NOT NULL DEFAULT 0,
             money      INT          NOT NULL DEFAULT 10000,
             wx         DOUBLE       NULL,
             wy         DOUBLE       NULL,
             dir        VARCHAR(1)   NOT NULL DEFAULT 'n',
             uniform    VARCHAR(8)   NOT NULL DEFAULT 'sma',
             hair_style VARCHAR(12)  NOT NULL DEFAULT 'short',
             hair_color VARCHAR(16)  NOT NULL DEFAULT '#1e293b',
             skin_color VARCHAR(16)  NOT NULL DEFAULT '#f6d198',
             updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
             PRIMARY KEY (user_id),
             CONSTRAINT fk_gns_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
           )`
        : `CREATE TABLE IF NOT EXISTS game_nusantara_state (
             user_id    UUID        NOT NULL,
             class_id   BIGINT      NULL,
             xp         INT         NOT NULL DEFAULT 0,
             money      INT         NOT NULL DEFAULT 10000,
             wx         DOUBLE PRECISION NULL,
             wy         DOUBLE PRECISION NULL,
             dir        VARCHAR(1)  NOT NULL DEFAULT 'n',
             uniform    VARCHAR(8)  NOT NULL DEFAULT 'sma',
             hair_style VARCHAR(12) NOT NULL DEFAULT 'short',
             hair_color VARCHAR(16) NOT NULL DEFAULT '#1e293b',
             skin_color VARCHAR(16) NOT NULL DEFAULT '#f6d198',
             updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
             CONSTRAINT pk_game_nusantara_state PRIMARY KEY (user_id),
             CONSTRAINT fk_gns_user FOREIGN KEY (user_id)
                 REFERENCES users(id) ON DELETE CASCADE
           )`;
      await query(ddl, []);
      const requiredColumns: Array<{ name: string; mysqlDef: string; pgDef: string }> = [
        { name: "uniform", mysqlDef: "VARCHAR(8) NOT NULL DEFAULT 'sma'", pgDef: "VARCHAR(8) NOT NULL DEFAULT 'sma'" },
        { name: "hair_style", mysqlDef: "VARCHAR(12) NOT NULL DEFAULT 'short'", pgDef: "VARCHAR(12) NOT NULL DEFAULT 'short'" },
        { name: "hair_color", mysqlDef: "VARCHAR(16) NOT NULL DEFAULT '#1e293b'", pgDef: "VARCHAR(16) NOT NULL DEFAULT '#1e293b'" },
        { name: "skin_color", mysqlDef: "VARCHAR(16) NOT NULL DEFAULT '#f6d198'", pgDef: "VARCHAR(16) NOT NULL DEFAULT '#f6d198'" },
      ];
      for (const col of requiredColumns) {
        if (mysql) {
          try {
            await query(
              `ALTER TABLE game_nusantara_state ADD COLUMN ${col.name} ${col.mysqlDef}`,
              []
            );
          } catch (err: any) {
            const msg = String(err?.message || "");
            if (err?.errno !== 1060 && !/Duplicate column/i.test(msg)) throw err;
          }
        } else {
          await query(
            `ALTER TABLE game_nusantara_state ADD COLUMN IF NOT EXISTS ${col.name} ${col.pgDef}`,
            []
          );
        }
      }
    })().catch((err) => {
      gameTableReady = null;
      throw err;
    });
  }
  return gameTableReady;
}

/**
 * Fetches the authoritative class membership for a student from `student_profiles`.
 * Intentionally does NOT swallow database errors so transient DB failures reject
 * room entry rather than misrouting students into a fallback room.
 */
export async function fetchStudentClassProfile(
  userId: string
): Promise<StudentClassProfileRow | null> {
  return await queryOne<StudentClassProfileRow>(
    `SELECT sp.class_id, c.class_name, c.grade_level
     FROM student_profiles sp
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE sp.user_id = $1`,
    [userId]
  );
}

export async function loadGameState(userId: string): Promise<GameStateRow | null> {
  try {
    await ensureGameTable();
    return await queryOne<GameStateRow>(
      `SELECT xp, money, wx, wy, dir, uniform, hair_style, hair_color, skin_color
       FROM game_nusantara_state WHERE user_id = $1`,
      [userId]
    );
  } catch (err) {
    console.error("[nusantara] load game state failed:", err);
    return null;
  }
}

/** UPSERT progres — ON CONFLICT diterjemahkan db.ts ke ON DUPLICATE KEY (MySQL). */
export async function saveGameState(
  userId: string,
  p: PlayerState,
  classId: string | null
): Promise<void> {
  try {
    await ensureGameTable();
    const numericClassId = classId && /^\d+$/.test(classId) ? Number(classId) : null;
    const safeClassId =
      numericClassId !== null && Number.isSafeInteger(numericClassId) ? numericClassId : null;

    await query(
      `INSERT INTO game_nusantara_state (user_id, class_id, xp, money, wx, wy, dir, uniform, hair_style, hair_color, skin_color, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         class_id = EXCLUDED.class_id,
         xp = EXCLUDED.xp, money = EXCLUDED.money, wx = EXCLUDED.wx,
         wy = EXCLUDED.wy, dir = EXCLUDED.dir, uniform = EXCLUDED.uniform,
         hair_style = EXCLUDED.hair_style, hair_color = EXCLUDED.hair_color,
         skin_color = EXCLUDED.skin_color, updated_at = NOW()`,
      [
        userId,
        safeClassId,
        p.xp,
        p.money,
        p.wx,
        p.wy,
        p.dir,
        p.role,
        p.hairStyle,
        p.hairColor,
        p.skinColor,
      ]
    );
  } catch (err) {
    console.error("[nusantara] save game state failed:", err);
  }
}
