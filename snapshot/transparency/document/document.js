"use strict";

const documents = {
  provenance: {
    title: "原資料来歴監査",
    description: "取得元、件数、識別情報、ハッシュ確認の記録",
    path: "/transparency/documents/provenance.md"
  },
  inventory: {
    title: "データ構成一覧",
    description: "収録データ、用途、保全状況の記録",
    path: "/transparency/documents/inventory.md"
  },
  review: {
    title: "専門レビュー結果",
    description: "確認内容、指摘への対応、利益相反の記録",
    path: "/transparency/documents/review-2026-08-24.md"
  },
  changelog: {
    title: "更新履歴",
    description: "利用者に影響する変更の記録",
    path: "/transparency/documents/changelog.md"
  }
};

const key = new URLSearchParams(location.search).get("doc");
const selected = Object.hasOwn(documents, key) ? documents[key] : undefined;
const title = document.getElementById("doc-title");
const description = document.getElementById("doc-description");
const status = document.getElementById("doc-status");
const output = document.getElementById("document");
const error = document.getElementById("doc-error");

if (!selected) {
  title.textContent = "指定された資料がありません";
  description.textContent = "透明性ページから資料を選択してください。";
  status.hidden = true;
  error.hidden = false;
} else {
  title.textContent = selected.title;
  description.textContent = selected.description;
  document.title = selected.title + "｜全国市町村別標準化死亡比";

  fetch(selected.path, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok || !/^text\/(?:markdown|plain)(?:;|$)/i.test(response.headers.get("Content-Type") || "")) {
        throw new Error("Document response is unavailable");
      }
      return response.arrayBuffer();
    })
    .then((buffer) => {
      let text = new TextDecoder("utf-8").decode(buffer);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      if (!text.startsWith("# ")) throw new Error("Invalid document body");
      output.textContent = text;
      status.hidden = true;
      output.hidden = false;
    })
    .catch(() => {
      status.hidden = true;
      error.hidden = false;
    });
}
