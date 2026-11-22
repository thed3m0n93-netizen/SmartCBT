import test from "node:test";
import assert from "node:assert/strict";
import {
  NusantaraRoomRegistry,
  normalizeClassId,
  resolveLobbyDescriptor,
} from "./nusantara-rooms.js";
import type { PlayerState } from "../../game/nusantara/schoolMap.js";

function makePlayer(id: string, name: string): PlayerState {
  return {
    id,
    name,
    role: "sma",
    hairStyle: "short",
    hairColor: "#1e293b",
    skinColor: "#f6d198",
    wx: 15,
    wy: 27,
    dir: "s",
    moving: false,
    sprinting: false,
    sitting: false,
    jumpOffset: 0,
    xp: 0,
    money: 10000,
    energy: 100,
  };
}

test("normalizeClassId canonicalizes number, bigint, and padded strings", () => {
  assert.equal(normalizeClassId(10), "10");
  assert.equal(normalizeClassId(10n), "10");
  assert.equal(normalizeClassId(" 010 "), "10");
  assert.equal(normalizeClassId("10"), "10");
  assert.equal(normalizeClassId(""), null);
  assert.equal(normalizeClassId("   "), null);
  assert.equal(normalizeClassId(null), null);
  assert.equal(normalizeClassId(undefined), null);
});

test("students from different classes always resolve to distinct rooms", () => {
  const s1 = resolveLobbyDescriptor(
    { id: "stu-1", role: "student" },
    { class_id: 1, class_name: "IPA 1", grade_level: "X" }
  );
  const s2 = resolveLobbyDescriptor(
    { id: "stu-2", role: "student" },
    { class_id: "2", class_name: "IPA 2", grade_level: "X" }
  );
  const s1SameClassFromPostgresString = resolveLobbyDescriptor(
    { id: "stu-3", role: "student" },
    { class_id: "1", class_name: "IPA 1", grade_level: "X" }
  );

  assert.equal(s1.room, "class:1");
  assert.equal(s2.room, "class:2");
  assert.notEqual(s1.room, s2.room);
  assert.equal(s1SameClassFromPostgresString.room, s1.room);
});

test("unassigned students are isolated per user instead of sharing a fallback pool", () => {
  const u1 = resolveLobbyDescriptor({ id: "user-a", role: "student" }, null);
  const u2 = resolveLobbyDescriptor({ id: "user-b", role: "student" }, null);
  assert.equal(u1.room, "unassigned:user-a");
  assert.equal(u2.room, "unassigned:user-b");
  assert.notEqual(u1.room, u2.room);
});

test("staff accounts map strictly to staff room and never mix with student rooms", () => {
  const teacher = resolveLobbyDescriptor({ id: "t-1", role: "teacher" }, null);
  const student = resolveLobbyDescriptor(
    { id: "stu-1", role: "student" },
    { class_id: 1, class_name: "A", grade_level: "XI" }
  );
  assert.equal(teacher.room, "staff");
  assert.notEqual(teacher.room, student.room);
});

test("NusantaraRoomRegistry.snapshotRoom never leaks players across class rooms", () => {
  const reg = new NusantaraRoomRegistry();

  reg.registerPlayer("sock-a1", makePlayer("sock-a1", "Ani"), {
    userId: "u-a1",
    role: "student",
    room: "class:1",
    classId: "1",
    classLabel: "X IPA 1",
  });
  reg.registerPlayer("sock-a2", makePlayer("sock-a2", "Budi"), {
    userId: "u-a2",
    role: "student",
    room: "class:1",
    classId: "1",
    classLabel: "X IPA 1",
  });
  reg.registerPlayer("sock-b1", makePlayer("sock-b1", "Citra"), {
    userId: "u-b1",
    role: "student",
    room: "class:2",
    classId: "2",
    classLabel: "X IPA 2",
  });
  reg.registerPlayer("sock-t1", makePlayer("sock-t1", "Pak Eko"), {
    userId: "u-t1",
    role: "teacher",
    room: "staff",
    classId: null,
    classLabel: "Ruang Guru",
  });

  const room1 = reg.snapshotRoom("class:1", "1");
  const room2 = reg.snapshotRoom("class:2", "2");
  const staffRoom = reg.snapshotRoom("staff", null);

  assert.deepEqual(Object.keys(room1).sort(), ["sock-a1", "sock-a2"]);
  assert.deepEqual(Object.keys(room2), ["sock-b1"]);
  assert.deepEqual(Object.keys(staffRoom), ["sock-t1"]);
  assert.equal(reg.onlineCount, 4);
  assert.equal(reg.snapshotLobbies().length, 3);
});

test("NusantaraRoomRegistry guards concurrent join races and tracks user sockets for eviction", () => {
  const reg = new NusantaraRoomRegistry();
  assert.equal(reg.beginJoin("sock-1"), true);
  assert.equal(reg.beginJoin("sock-1"), false);
  reg.registerPlayer("sock-1", makePlayer("sock-1", "Ani"), {
    userId: "u-1",
    role: "student",
    room: "class:1",
    classId: "1",
    classLabel: "X IPA 1",
  });
  reg.endJoin("sock-1");
  assert.deepEqual(reg.findSocketsByUserId("u-1"), ["sock-1"]);
  assert.equal(reg.beginJoin("sock-1"), false);
  reg.removePlayer("sock-1");
  assert.deepEqual(reg.findSocketsByUserId("u-1"), []);
});
