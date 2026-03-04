"use strict";

const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "zaseki.db");

// ===== DB セットアップ =====
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS class_data (
    grade      INTEGER NOT NULL,
    class_num  INTEGER NOT NULL,
    data       TEXT    NOT NULL,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (grade, class_num)
  )
`);

const getStmt = db.prepare(
  "SELECT data FROM class_data WHERE grade = ? AND class_num = ?"
);

const upsertStmt = db.prepare(`
  INSERT INTO class_data (grade, class_num, data, updated_at)
  VALUES (?, ?, ?, datetime('now','localtime'))
  ON CONFLICT(grade, class_num) DO UPDATE SET
    data       = excluded.data,
    updated_at = excluded.updated_at
`);

// ===== ミドルウェア =====
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

// ===== API =====

// クラスデータ取得
app.get("/api/class/:grade/:classNum", (req, res) => {
  const grade    = parseInt(req.params.grade, 10);
  const classNum = parseInt(req.params.classNum, 10);
  if (isNaN(grade) || isNaN(classNum)) {
    return res.status(400).json({ error: "Invalid params" });
  }

  const row = getStmt.get(grade, classNum);
  if (!row) return res.json(null);

  try {
    res.json(JSON.parse(row.data));
  } catch {
    res.json(null);
  }
});

// クラスデータ保存
app.put("/api/class/:grade/:classNum", (req, res) => {
  const grade    = parseInt(req.params.grade, 10);
  const classNum = parseInt(req.params.classNum, 10);
  if (isNaN(grade) || isNaN(classNum)) {
    return res.status(400).json({ error: "Invalid params" });
  }

  try {
    upsertStmt.run(grade, classNum, JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (err) {
    console.error("保存エラー:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log(`座席表サーバー起動中: http://localhost:${PORT}`);
});
