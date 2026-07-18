(function () {
  "use strict";

  var STORAGE_KEY = "hayday_catalog_mapping_draft_v1";
  var PAGE_SIZE = 15;
  var DECISIONS = ["matched", "new", "unrelated", "unsure"];
  var state = {
    reference: { items: [], buildings: [] },
    base: { items: [], buildings: [] },
    local: { items: [], buildings: [] },
    mappings: { item: {}, building: {} },
    kind: "item",
    search: "",
    status: "all",
    page: 1,
    importedBackupName: "",
    loadedMappingName: ""
  };
  var toastTimer = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function showToast(message) {
    var toast = byId("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2400);
  }

  function normalizedStoredMapping(mapping) {
    if (!mapping || typeof mapping !== "object") return null;
    var decision = mapping.decision;
    if (DECISIONS.indexOf(decision) < 0) {
      if (mapping.status === "confirmed") decision = mapping.legacyId ? "matched" : "new";
      else if (mapping.status === "excluded") decision = "unrelated";
    }
    if (DECISIONS.indexOf(decision) < 0) return null;
    return {
      decision: decision,
      nameCN: String(mapping.nameCN || ""),
      legacyId: String(mapping.legacyId || ""),
      savedAt: String(mapping.savedAt || "")
    };
  }

  function readDraft() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed.mappings !== "object") return;
      ["item", "building"].forEach(function (kind) {
        var source = parsed.mappings[kind];
        if (!source || typeof source !== "object" || Array.isArray(source)) return;
        Object.keys(source).forEach(function (canonicalId) {
          var normalized = normalizedStoredMapping(source[canonicalId]);
          if (normalized) state.mappings[kind][canonicalId] = normalized;
        });
      });
    } catch (error) {
      console.warn("忽略损坏或不可读取的目录对照草稿", error);
    }
  }

  function mappingCount() {
    return Object.keys(state.mappings.item).length + Object.keys(state.mappings.building).length;
  }

  async function readExportedMappingWhenDraftIsEmpty() {
    if (mappingCount()) return;
    try {
      var exported = await loadJson("./catalog-id-image-mapping.json");
      if (!exported || exported.type !== "hayday-catalog-id-image-mapping") return;
      [
        { kind: "item", rows: exported.items },
        { kind: "building", rows: exported.buildings }
      ].forEach(function (group) {
        (Array.isArray(group.rows) ? group.rows : []).forEach(function (row) {
          if (!row || !row.canonicalId) return;
          var normalized = normalizedStoredMapping(row);
          if (normalized) state.mappings[group.kind][String(row.canonicalId)] = normalized;
        });
      });
      if (mappingCount()) {
        state.importedBackupName = String(exported.importedBackupName || "");
        state.loadedMappingName = "catalog-id-image-mapping.json";
      }
    } catch (error) {
      console.warn("未找到可用于查看的已导出目录对照表", error);
    }
  }

  function persistDraft() {
    var indicator = byId("saveIndicator");
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          updatedAt: new Date().toISOString(),
          mappings: state.mappings
        })
      );
      indicator.textContent = "草稿已保存在本浏览器";
      clearTimeout(indicator._timer);
      indicator._timer = setTimeout(function () {
        indicator.textContent = "草稿仅保存在本浏览器";
      }, 1800);
      return true;
    } catch (error) {
      indicator.textContent = "浏览器未允许本地保存，请及时导出";
      console.warn("目录对照草稿无法写入浏览器", error);
      return false;
    }
  }

  function referenceRows(kind) {
    return kind === "building" ? state.reference.buildings : state.reference.items;
  }

  function localRows(kind) {
    return kind === "building" ? state.local.buildings : state.local.items;
  }

  function mappingFor(kind, canonicalId) {
    return state.mappings[kind][canonicalId] || null;
  }

  function referenceById(kind, canonicalId) {
    return referenceRows(kind).find(function (row) {
      return row.canonicalId === canonicalId;
    }) || null;
  }

  function localById(kind, legacyId) {
    return localRows(kind).find(function (row) {
      return row.legacyId === legacyId;
    }) || null;
  }

  function effectiveName(kind, mapping) {
    var local = mapping && mapping.legacyId ? localById(kind, mapping.legacyId) : null;
    return local ? local.nameCN : String(mapping && mapping.nameCN || "");
  }

  function applyBackupCatalog(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("备份格式错误");
    if (!data.items || typeof data.items !== "object" || Array.isArray(data.items)) throw new Error("缺少备份物品数据");

    var items = clone(state.base.items);
    var edits = data.edits && typeof data.edits === "object" && !Array.isArray(data.edits) ? data.edits : {};
    var modified = edits.mod && typeof edits.mod === "object" && !Array.isArray(edits.mod) ? edits.mod : {};
    var deleted = new Set(Array.isArray(edits.del) ? edits.del : []);

    items.forEach(function (item) {
      var change = modified[item.legacyId];
      if (!change || typeof change !== "object") return;
      if (typeof change.nameCN === "string" && change.nameCN.trim()) item.nameCN = change.nameCN.trim();
      if (typeof change.bld === "string") item.buildingId = change.bld;
    });

    if (Array.isArray(edits.add)) {
      edits.add.forEach(function (item) {
        if (!item || typeof item !== "object" || !item.id || deleted.has(item.id)) return;
        if (items.some(function (existing) { return existing.legacyId === item.id; })) return;
        items.push({
          legacyId: String(item.id),
          nameCN: String(item.nameCN || item.id),
          buildingId: String(item.bld || ""),
          kind: "item"
        });
      });
    }

    state.local.items = items.filter(function (item) {
      return !deleted.has(item.legacyId);
    });
    state.local.buildings = clone(state.base.buildings);
    renderAll();
  }

  function addConflict(audit, kind, canonicalId, reason) {
    audit[kind].add(canonicalId);
    if (!audit.reasons[kind][canonicalId]) audit.reasons[kind][canonicalId] = [];
    if (audit.reasons[kind][canonicalId].indexOf(reason) < 0) {
      audit.reasons[kind][canonicalId].push(reason);
    }
  }

  function conflictState() {
    var audit = {
      item: new Set(),
      building: new Set(),
      reasons: { item: Object.create(null), building: Object.create(null) }
    };

    ["item", "building"].forEach(function (kind) {
      var byLegacy = Object.create(null);
      var byName = Object.create(null);
      var selectedByLegacy = Object.create(null);

      Object.keys(state.mappings[kind]).forEach(function (canonicalId) {
        var mapping = state.mappings[kind][canonicalId];
        if (!mapping) return;
        var name = normalizeText(effectiveName(kind, mapping));
        if (mapping.decision === "matched") {
          var legacy = normalizeText(mapping.legacyId);
          if (!legacy || !localById(kind, mapping.legacyId)) {
            addConflict(audit, kind, canonicalId, "关联的现有 ID 已不存在，请重新选择。");
          } else {
            (byLegacy[legacy] || (byLegacy[legacy] = [])).push(canonicalId);
            selectedByLegacy[mapping.legacyId] = canonicalId;
          }
        }
        if ((mapping.decision === "matched" || mapping.decision === "new") && name) {
          (byName[name] || (byName[name] = [])).push(canonicalId);
        }
        if (mapping.decision === "new" && !name) {
          addConflict(audit, kind, canonicalId, "网站新增项目缺少中文名。");
        }
        if (mapping.decision === "new" && name && localRows(kind).some(function (local) {
          return normalizeText(local.nameCN) === name;
        })) {
          addConflict(audit, kind, canonicalId, "这个中文名已存在，应选择现有项目而不是新增。");
        }
      });

      Object.keys(byLegacy).forEach(function (legacyId) {
        if (byLegacy[legacyId].length < 2) return;
        byLegacy[legacyId].forEach(function (canonicalId) {
          addConflict(audit, kind, canonicalId, "同一个现有 ID 被多个英文项目选择。");
        });
      });

      Object.keys(byName).forEach(function (name) {
        if (byName[name].length < 2) return;
        byName[name].forEach(function (canonicalId) {
          addConflict(audit, kind, canonicalId, "同一个中文名对应了多个英文项目。");
        });
      });

      Object.keys(state.mappings[kind]).forEach(function (canonicalId) {
        var mapping = state.mappings[kind][canonicalId];
        if (!mapping || (mapping.decision !== "matched" && mapping.decision !== "new")) return;
        var occupant = localById(kind, canonicalId);
        if (!occupant) return;
        if (mapping.decision === "matched" && mapping.legacyId === canonicalId) return;
        var occupantMappingId = selectedByLegacy[canonicalId];
        var occupantMapping = occupantMappingId ? mappingFor(kind, occupantMappingId) : null;
        var occupantWillMove = occupantMapping && occupantMappingId !== canonicalId;
        if (!occupantWillMove) {
          addConflict(audit, kind, canonicalId, "网站规范 ID 已被另一个现有项目占用。");
        }
      });
    });
    return audit;
  }

  function rowStatus(kind, canonicalId, conflicts) {
    var mapping = mappingFor(kind, canonicalId);
    if (conflicts[kind].has(canonicalId)) return "conflict";
    if (!mapping) return "pending";
    return mapping.decision;
  }

  function statusLabel(status) {
    if (status === "matched") return "已对应";
    if (status === "new") return "网站新增";
    if (status === "unrelated") return "无对应项";
    if (status === "unsure") return "暂无法判断";
    if (status === "conflict") return "需要处理冲突";
    return "待处理";
  }

  function exactSuggestion(kind, reference) {
    var local = localById(kind, reference.canonicalId);
    if (!local) return null;
    var used = Object.keys(state.mappings[kind]).some(function (canonicalId) {
      var mapping = state.mappings[kind][canonicalId];
      return canonicalId !== reference.canonicalId &&
        mapping &&
        mapping.decision === "matched" &&
        mapping.legacyId === local.legacyId;
    });
    return used ? null : local;
  }

  function filteredRows(conflicts) {
    var query = normalizeText(state.search);
    return referenceRows(state.kind).filter(function (reference) {
      var mapping = mappingFor(state.kind, reference.canonicalId);
      var status = rowStatus(state.kind, reference.canonicalId, conflicts);
      if (state.status !== "all" && status !== state.status) return false;
      if (!query) return true;
      var local = mapping && mapping.legacyId ? localById(state.kind, mapping.legacyId) : null;
      return [
        reference.nameEN,
        reference.canonicalId,
        reference.sourceLabel,
        mapping && effectiveName(state.kind, mapping),
        mapping && mapping.legacyId,
        local && local.nameCN
      ].join(" ").toLowerCase().indexOf(query) >= 0;
    });
  }

  function renderReferenceCell(reference) {
    return (
      '<div class="reference-cell">' +
        '<div class="reference-image"><img loading="lazy" src="' + escapeHtml(reference.imageUrl) + '" alt="' + escapeHtml(reference.nameEN) + '"></div>' +
        '<div class="reference-copy">' +
          "<strong>" + escapeHtml(reference.nameEN) + "</strong>" +
          "<code>" + escapeHtml(reference.canonicalId) + "</code>" +
          (reference.sourceLabel ? "<small>来源设备：" + escapeHtml(reference.sourceLabel) + "</small>" : "<small>生产设备资料</small>") +
          '<a href="' + escapeHtml(reference.sourceUrl) + '" target="_blank" rel="noreferrer">查看来源页 ↗</a>' +
        "</div>" +
      "</div>"
    );
  }

  function usedByLabel(kind, legacyId, currentCanonicalId) {
    var canonicalId = Object.keys(state.mappings[kind]).find(function (id) {
      var mapping = state.mappings[kind][id];
      return id !== currentCanonicalId &&
        mapping &&
        mapping.decision === "matched" &&
        mapping.legacyId === legacyId;
    });
    var reference = canonicalId ? referenceById(kind, canonicalId) : null;
    return reference ? "已被 " + reference.nameEN + " 使用" : "";
  }

  function searchLocalCandidates(kind, query, currentCanonicalId) {
    var normalized = normalizeText(query);
    var rows = localRows(kind).map(function (local) {
      var name = normalizeText(local.nameCN);
      var legacy = normalizeText(local.legacyId);
      var rank = 4;
      if (!normalized) rank = 3;
      else if (name === normalized || legacy === normalized) rank = 0;
      else if (name.indexOf(normalized) === 0 || legacy.indexOf(normalized) === 0) rank = 1;
      else if (name.indexOf(normalized) >= 0 || legacy.indexOf(normalized) >= 0) rank = 2;
      return { local: local, rank: rank };
    }).filter(function (entry) {
      return entry.rank < 4;
    });
    rows.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.local.nameCN.localeCompare(b.local.nameCN, "zh-CN");
    });
    return rows.slice(0, 10).map(function (entry) {
      return {
        local: entry.local,
        usedBy: usedByLabel(kind, entry.local.legacyId, currentCanonicalId)
      };
    });
  }

  function renderPicker(reference) {
    var suggestion = exactSuggestion(state.kind, reference);
    return (
      '<div class="mapping-cell chooser">' +
        '<label class="local-search-box">' +
          "<span>搜索中文名或现有 ID</span>" +
          '<input class="local-search-input" type="search" autocomplete="off" placeholder="例如：苹果派、apple_pie">' +
          '<div class="local-results" hidden></div>' +
        "</label>" +
        '<div class="picker-help">' +
          "<span>点选搜索结果即确认对应，中文名和旧 ID 会自动记录。</span>" +
          (suggestion ? '<button class="suggestion-button" type="button" data-suggest-id="' + escapeHtml(suggestion.legacyId) + '">采用同 ID 建议：' + escapeHtml(suggestion.nameCN) + "</button>" : "") +
        "</div>" +
        '<div class="decision-actions">' +
          '<button class="decision-button new-action" type="button">网站新增项目</button>' +
          '<button class="decision-button unrelated-action" type="button">无对应项</button>' +
          '<button class="decision-button unsure-action" type="button">暂无法判断</button>' +
        "</div>" +
        '<div class="new-item-form" hidden>' +
          '<label><span>新增项目中文名</span><input class="new-cn-input" type="text" placeholder="填写确认后的中文名"></label>' +
          '<button class="button button-primary save-new" type="button">保存为网站新增项目</button>' +
        "</div>" +
      "</div>"
    );
  }

  function migrationPreview(reference, mapping, kind) {
    var nameCN = effectiveName(kind, mapping);
    if (mapping.decision === "matched") {
      var sameId = mapping.legacyId === reference.canonicalId;
      return (
        '<div class="selected-local">' +
          '<img class="current-image" loading="lazy" src="./icons/' + escapeHtml(mapping.legacyId) + '.png" alt="">' +
          '<div><span class="selected-label">现有中文项目与当前图片</span>' +
          "<strong>" + escapeHtml(nameCN) + "</strong>" +
          "<code>" + escapeHtml(mapping.legacyId) + "</code></div>" +
        "</div>" +
        '<div class="change-preview">' +
          "<span>正式迁移预览</span>" +
          '<div><code>' + escapeHtml(mapping.legacyId) + "</code><b>→</b><code>" + escapeHtml(reference.canonicalId) + "</code></div>" +
          "<small>" + (sameId ? "ID 已规范，无需改名；" : "将同步更新所有 ID 引用；") + "内置图片换为左侧图片，用户上传图片保留。</small>" +
        "</div>"
      );
    }
    if (mapping.decision === "new") {
      return (
        '<div class="selected-local">' +
          '<span class="selected-label">网站新增项目</span>' +
          "<strong>" + escapeHtml(nameCN) + "</strong>" +
          "<code>新 ID：" + escapeHtml(reference.canonicalId) + "</code>" +
        "</div>" +
        '<div class="change-preview"><small>正式迁移时新增项目并下载左侧图片；不会从参考网站导入时间或配方。</small></div>'
      );
    }
    if (mapping.decision === "unrelated") {
      return '<div class="decision-summary neutral"><strong>已标记为无对应项</strong><small>正式迁移时忽略这条网站资料。</small></div>';
    }
    return '<div class="decision-summary warning"><strong>暂时无法判断</strong><small>此项仍需以后重新确认，不会进入正式迁移。</small></div>';
  }

  function renderMappingCell(kind, reference, mapping, conflicts) {
    if (!mapping) return renderPicker(reference);
    var reasons = conflicts.reasons[kind][reference.canonicalId] || [];
    return (
      '<div class="mapping-cell saved-decision">' +
        migrationPreview(reference, mapping, kind) +
        (reasons.length
          ? '<ul class="inline-conflicts">' + reasons.map(function (reason) { return "<li>" + escapeHtml(reason) + "</li>"; }).join("") + "</ul>"
          : "") +
        '<button class="reset-decision" type="button">重新判断</button>' +
      "</div>"
    );
  }

  function renderStatusCell(status) {
    return (
      '<div class="row-status">' +
        '<span class="status-pill ' + status + '">' + statusLabel(status) + "</span>" +
      "</div>"
    );
  }

  function renderRows() {
    var conflicts = conflictState();
    var rows = filteredRows(conflicts);
    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PAGE_SIZE;
    var visible = rows.slice(start, start + PAGE_SIZE);

    byId("catalogList").innerHTML = visible.map(function (reference) {
      var mapping = mappingFor(state.kind, reference.canonicalId);
      var status = rowStatus(state.kind, reference.canonicalId, conflicts);
      return (
        '<article class="catalog-row is-' + status + '" data-canonical-id="' + escapeHtml(reference.canonicalId) + '">' +
          renderReferenceCell(reference) +
          renderMappingCell(state.kind, reference, mapping, conflicts) +
          renderStatusCell(status) +
        "</article>"
      );
    }).join("");

    byId("emptyState").hidden = visible.length !== 0;
    byId("pager").hidden = rows.length === 0;
    byId("pageInfo").textContent = "第 " + state.page + " / " + totalPages + " 页 · " + rows.length + " 项";
    byId("prevPage").disabled = state.page <= 1;
    byId("nextPage").disabled = state.page >= totalPages;

    Array.prototype.forEach.call(byId("catalogList").querySelectorAll(".reference-image img"), function (image) {
      image.addEventListener("error", function () {
        var frame = image.parentElement;
        frame.classList.add("image-error");
        frame.textContent = "图片暂时无法加载";
      }, { once: true });
    });
    Array.prototype.forEach.call(byId("catalogList").querySelectorAll(".current-image"), function (image) {
      image.addEventListener("error", function () {
        var placeholder = document.createElement("span");
        placeholder.className = "current-image-missing";
        placeholder.textContent = "暂无";
        image.replaceWith(placeholder);
      }, { once: true });
    });
  }

  function currentUsedLegacyIds(kind) {
    var used = new Set();
    Object.keys(state.mappings[kind]).forEach(function (canonicalId) {
      var mapping = state.mappings[kind][canonicalId];
      if (mapping && mapping.decision === "matched" && mapping.legacyId) used.add(mapping.legacyId);
    });
    return used;
  }

  function allUnmatchedLocalRows() {
    var result = [];
    ["item", "building"].forEach(function (kind) {
      var used = currentUsedLegacyIds(kind);
      localRows(kind).forEach(function (row) {
        if (!used.has(row.legacyId)) result.push({ kind: kind, legacyId: row.legacyId, nameCN: row.nameCN });
      });
    });
    return result;
  }

  function renderUnmatched() {
    var used = currentUsedLegacyIds(state.kind);
    var rows = localRows(state.kind).filter(function (row) {
      return !used.has(row.legacyId);
    });
    byId("unmatchedHeadingCount").textContent = rows.length + " 项";
    byId("unmatchedList").innerHTML = rows.map(function (row) {
      return (
        '<div class="unmatched-item">' +
          "<strong>" + escapeHtml(row.nameCN) + "</strong>" +
          "<code>" + escapeHtml(row.legacyId) + "</code>" +
        "</div>"
      );
    }).join("");
  }

  function progressSummary() {
    var conflicts = conflictState();
    var summary = {
      total: 0,
      matched: 0,
      newItems: 0,
      unrelated: 0,
      unsure: 0,
      pending: 0,
      conflicts: 0,
      unmatched: 0
    };
    ["item", "building"].forEach(function (kind) {
      referenceRows(kind).forEach(function (reference) {
        summary.total++;
        var status = rowStatus(kind, reference.canonicalId, conflicts);
        if (status === "matched") summary.matched++;
        else if (status === "new") summary.newItems++;
        else if (status === "unrelated") summary.unrelated++;
        else if (status === "unsure") summary.unsure++;
        else if (status === "conflict") summary.conflicts++;
        else summary.pending++;
      });
    });
    summary.completed = summary.matched + summary.newItems + summary.unrelated;
    summary.remaining = summary.pending + summary.unsure + summary.conflicts;
    summary.unmatched = allUnmatchedLocalRows().length;
    return summary;
  }

  function renderStats() {
    var summary = progressSummary();
    byId("completedStat").textContent = summary.completed;
    byId("totalStat").textContent = summary.total;
    byId("totalDetail").textContent = state.reference.items.length + " 个物品 · " + state.reference.buildings.length + " 个设备";
    byId("pendingStat").textContent = summary.pending + summary.unsure;
    byId("pendingDetail").textContent = summary.pending + " 项待处理 · " + summary.unsure + " 项暂不确定";
    byId("conflictStat").textContent = summary.conflicts;
    byId("unmatchedStat").textContent = summary.unmatched;
    byId("progressBar").style.width = (summary.total ? (summary.completed / summary.total) * 100 : 0) + "%";
    byId("itemTabCount").textContent = state.reference.items.length;
    byId("buildingTabCount").textContent = state.reference.buildings.length;
  }

  function renderAll() {
    renderRows();
    renderUnmatched();
    renderStats();
  }

  function saveDecision(kind, canonicalId, decision, nameCN, legacyId) {
    state.mappings[kind][canonicalId] = {
      decision: decision,
      nameCN: String(nameCN || ""),
      legacyId: String(legacyId || ""),
      savedAt: new Date().toISOString()
    };
    persistDraft();
    renderAll();
  }

  function chooseLocal(row, legacyId) {
    var local = localById(state.kind, legacyId);
    if (!local) {
      showToast("这个现有 ID 已不在当前中文目录中");
      return;
    }
    saveDecision(state.kind, row.getAttribute("data-canonical-id"), "matched", local.nameCN, local.legacyId);
    showToast("已确认：" + local.nameCN + "；旧 ID 和图片迁移计划已记录");
  }

  function showLocalResults(row, query) {
    var results = row.querySelector(".local-results");
    var canonicalId = row.getAttribute("data-canonical-id");
    var candidates = searchLocalCandidates(state.kind, query, canonicalId);
    if (!candidates.length) {
      results.innerHTML = '<div class="no-local-result">没有找到现有中文项目。若确实不存在，可选择“网站新增项目”。</div>';
    } else {
      results.innerHTML = candidates.map(function (entry) {
        return (
          '<button type="button" class="local-result" data-local-id="' + escapeHtml(entry.local.legacyId) + '">' +
            '<img class="current-image" loading="lazy" src="./icons/' + escapeHtml(entry.local.legacyId) + '.png" alt="">' +
            "<span><strong>" + escapeHtml(entry.local.nameCN) + "</strong><code>" + escapeHtml(entry.local.legacyId) + "</code></span>" +
            (entry.usedBy ? '<small class="used-warning">' + escapeHtml(entry.usedBy) + "</small>" : "<small>选择此项目</small>") +
          "</button>"
        );
      }).join("");
    }
    results.hidden = false;
  }

  function setSpecialDecision(row, decision) {
    var canonicalId = row.getAttribute("data-canonical-id");
    if (decision === "new") {
      var form = row.querySelector(".new-item-form");
      form.hidden = false;
      form.querySelector(".new-cn-input").focus();
      return;
    }
    if (decision === "unrelated") {
      saveDecision(state.kind, canonicalId, "unrelated", "", "");
      showToast("已标记为无对应项");
      return;
    }
    saveDecision(state.kind, canonicalId, "unsure", "", "");
    showToast("已暂存为无法判断，可以以后重新处理");
  }

  function saveNewDecision(row) {
    var nameCN = row.querySelector(".new-cn-input").value.trim();
    if (!nameCN) {
      showToast("请填写这个网站新增项目的中文名");
      return;
    }
    saveDecision(state.kind, row.getAttribute("data-canonical-id"), "new", nameCN, "");
    showToast("已保存为网站新增项目；正式迁移前仍会检查 ID 冲突");
  }

  function resetDecision(row) {
    delete state.mappings[state.kind][row.getAttribute("data-canonical-id")];
    persistDraft();
    renderAll();
    showToast("已恢复为待处理");
  }

  function setKind(kind) {
    state.kind = kind;
    state.page = 1;
    Array.prototype.forEach.call(document.querySelectorAll(".segmented button"), function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-kind") === kind ? "true" : "false");
    });
    renderAll();
  }

  function goToNextPending() {
    var conflicts = conflictState();
    var kinds = state.kind === "item" ? ["item", "building"] : ["building", "item"];
    var target = null;
    var targetKind = state.kind;
    kinds.some(function (kind) {
      var rows = referenceRows(kind);
      for (var index = 0; index < rows.length; index++) {
        var status = rowStatus(kind, rows[index].canonicalId, conflicts);
        if (status === "pending" || status === "unsure" || status === "conflict") {
          target = rows[index];
          targetKind = kind;
          state.page = Math.floor(index / PAGE_SIZE) + 1;
          return true;
        }
      }
      return false;
    });
    if (!target) {
      showToast("所有项目都已经完成判断");
      return;
    }
    state.kind = targetKind;
    state.search = "";
    state.status = "all";
    byId("searchInput").value = "";
    byId("statusFilter").value = "all";
    Array.prototype.forEach.call(document.querySelectorAll(".segmented button"), function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-kind") === targetKind ? "true" : "false");
    });
    renderAll();
    var targetRow = byId("catalogList").querySelector('[data-canonical-id="' + target.canonicalId + '"]');
    if (targetRow) targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function mappingExportData() {
    var conflicts = conflictState();
    function exportedRows(kind) {
      return referenceRows(kind).map(function (reference) {
        var mapping = mappingFor(kind, reference.canonicalId);
        if (!mapping) return null;
        var status = conflicts[kind].has(reference.canonicalId) ? "conflict" : mapping.decision;
        return {
          status: status,
          decision: mapping.decision,
          conflictReasons: conflicts.reasons[kind][reference.canonicalId] || [],
          legacyId: mapping.legacyId || "",
          canonicalId: reference.canonicalId,
          nameCN: effectiveName(kind, mapping),
          nameEN: reference.nameEN,
          imageUrl: reference.imageUrl,
          sourceLabel: reference.sourceLabel || "",
          sourceUrl: reference.sourceUrl,
          migrationPlan: {
            idFrom: mapping.decision === "matched" ? mapping.legacyId : "",
            idTo: mapping.decision === "matched" || mapping.decision === "new" ? reference.canonicalId : "",
            imageAction: mapping.decision === "matched" || mapping.decision === "new" ? "download_reference_image" : "none",
            preserveCustomImage: true
          }
        };
      }).filter(Boolean);
    }
    return {
      version: 2,
      type: "hayday-catalog-id-image-mapping",
      exportedAt: new Date().toISOString(),
      source: state.reference.source,
      policy: clone(state.reference.policy),
      importedBackupName: state.importedBackupName || "",
      summary: progressSummary(),
      items: exportedRows("item"),
      buildings: exportedRows("building")
    };
  }

  function exportMapping() {
    var data = mappingExportData();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "hayday_catalog_id_image_mapping_" + new Date().toISOString().slice(0, 10) + ".json";
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(anchor.href); }, 0);
    showToast("对照表已导出，不包含库存、配方、时间或用户图片内容");
  }

  function previewRows(conflicts) {
    var rows = [];
    ["item", "building"].forEach(function (kind) {
      referenceRows(kind).forEach(function (reference) {
        var mapping = mappingFor(kind, reference.canonicalId);
        if (!mapping || conflicts[kind].has(reference.canonicalId)) return;
        if (mapping.decision !== "matched" && mapping.decision !== "new") return;
        rows.push({
          kind: kind,
          nameCN: effectiveName(kind, mapping),
          from: mapping.decision === "matched" ? mapping.legacyId : "新增",
          to: reference.canonicalId,
          imageUrl: reference.imageUrl
        });
      });
    });
    return rows;
  }

  function openReviewDialog() {
    var summary = progressSummary();
    var conflicts = conflictState();
    var changes = previewRows(conflicts);
    var checks = [
      "<li>正式迁移将只使用英文名、网站规范 ID 和图片，不使用网站的时间、价格、配方或材料数量。</li>",
      "<li>现有库存、目标、排序、用户配方和生产时间需要在正式迁移时按旧 ID 一并搬到新 ID。</li>",
      "<li>网站图片将下载为项目内置图片；用户自己上传的图片默认保留，不自动覆盖。</li>"
    ];
    if (summary.conflicts) checks.push('<li class="danger">仍有 ' + summary.conflicts + " 项冲突，禁止执行正式迁移。</li>");
    if (summary.pending || summary.unsure) checks.push('<li class="warning">还有 ' + summary.pending + " 项待处理、" + summary.unsure + " 项暂无法判断。</li>");
    if (summary.unmatched) checks.push('<li class="warning">还有 ' + summary.unmatched + " 项本地资料未关联；它们不会被删除。</li>");
    checks.push('<li class="warning">当前按钮只显示预览，正式迁移功能仍未启用。</li>');

    var preview = changes.slice(0, 30).map(function (change) {
      return (
        '<div class="preview-row">' +
          '<img src="' + escapeHtml(change.imageUrl) + '" alt="">' +
          "<span><strong>" + escapeHtml(change.nameCN) + "</strong><small>" + (change.kind === "item" ? "物品" : "设备") + "</small></span>" +
          '<code>' + escapeHtml(change.from) + "</code><b>→</b><code>" + escapeHtml(change.to) + "</code>" +
        "</div>"
      );
    }).join("");

    byId("reviewDialogBody").innerHTML =
      '<div class="review-summary">' +
        "<div><span>对应现有项目</span><strong>" + summary.matched + "</strong></div>" +
        "<div><span>网站新增项目</span><strong>" + summary.newItems + "</strong></div>" +
        "<div><span>冲突</span><strong>" + summary.conflicts + "</strong></div>" +
      "</div>" +
      '<ul class="review-checks">' + checks.join("") + "</ul>" +
      '<div class="preview-list-head"><strong>迁移变化预览</strong><small>显示前 30 项，共 ' + changes.length + " 项可迁移</small></div>" +
      '<div class="preview-list">' + (preview || '<div class="no-preview">还没有已确认的 ID 或图片变化。</div>') + "</div>";
    byId("reviewDialog").showModal();
  }

  function importBackupFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        applyBackupCatalog(data);
        state.importedBackupName = file.name;
        showToast("已载入用户修正后的中文目录；库存、配方、时间和图片内容没有写入本工具");
      } catch (error) {
        showToast("备份读取失败：" + error.message);
      }
    };
    reader.onerror = function () {
      showToast("无法读取备份文件");
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.querySelector(".segmented").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-kind]");
      if (button) setKind(button.getAttribute("data-kind"));
    });

    byId("searchInput").addEventListener("input", function (event) {
      state.search = event.target.value;
      state.page = 1;
      renderRows();
    });

    byId("statusFilter").addEventListener("change", function (event) {
      state.status = event.target.value;
      state.page = 1;
      renderRows();
    });

    byId("catalogList").addEventListener("focusin", function (event) {
      if (!event.target.classList.contains("local-search-input")) return;
      showLocalResults(event.target.closest(".catalog-row"), event.target.value);
    });

    byId("catalogList").addEventListener("focusout", function (event) {
      if (!event.target.classList.contains("local-search-input")) return;
      var results = event.target.closest(".mapping-cell").querySelector(".local-results");
      setTimeout(function () { results.hidden = true; }, 120);
    });

    byId("catalogList").addEventListener("input", function (event) {
      if (!event.target.classList.contains("local-search-input")) return;
      showLocalResults(event.target.closest(".catalog-row"), event.target.value);
    });

    byId("catalogList").addEventListener("keydown", function (event) {
      if (!event.target.classList.contains("local-search-input") || event.key !== "Enter") return;
      var first = event.target.closest(".mapping-cell").querySelector(".local-result");
      if (first) {
        event.preventDefault();
        chooseLocal(event.target.closest(".catalog-row"), first.getAttribute("data-local-id"));
      }
    });

    byId("catalogList").addEventListener("click", function (event) {
      var row = event.target.closest(".catalog-row");
      if (!row) return;
      var localResult = event.target.closest("[data-local-id]");
      var suggestion = event.target.closest("[data-suggest-id]");
      if (localResult) chooseLocal(row, localResult.getAttribute("data-local-id"));
      else if (suggestion) chooseLocal(row, suggestion.getAttribute("data-suggest-id"));
      else if (event.target.closest(".new-action")) setSpecialDecision(row, "new");
      else if (event.target.closest(".unrelated-action")) setSpecialDecision(row, "unrelated");
      else if (event.target.closest(".unsure-action")) setSpecialDecision(row, "unsure");
      else if (event.target.closest(".save-new")) saveNewDecision(row);
      else if (event.target.closest(".reset-decision")) resetDecision(row);
    });

    byId("prevPage").addEventListener("click", function () {
      if (state.page > 1) {
        state.page--;
        renderRows();
        window.scrollTo({ top: byId("catalogList").getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
      }
    });

    byId("nextPage").addEventListener("click", function () {
      state.page++;
      renderRows();
      window.scrollTo({ top: byId("catalogList").getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
    });

    byId("nextPendingButton").addEventListener("click", goToNextPending);
    byId("exportButton").addEventListener("click", exportMapping);
    byId("dialogExportButton").addEventListener("click", exportMapping);
    byId("previewButton").addEventListener("click", openReviewDialog);
    byId("closeDialogButton").addEventListener("click", function () { byId("reviewDialog").close(); });
    byId("dialogDoneButton").addEventListener("click", function () { byId("reviewDialog").close(); });

    byId("importBackupButton").addEventListener("click", function () {
      byId("backupInput").click();
    });
    byId("backupInput").addEventListener("change", function (event) {
      var file = event.target.files && event.target.files[0];
      if (file) importBackupFile(file);
      event.target.value = "";
    });

    byId("clearButton").addEventListener("click", function () {
      if (!window.confirm("确定清空当前浏览器中的全部对照草稿吗？这不会影响库存助手数据。")) return;
      state.mappings = { item: {}, building: {} };
      try { localStorage.removeItem(STORAGE_KEY); } catch (error) { console.warn(error); }
      renderAll();
      showToast("对照草稿已清空，库存助手数据未改变");
    });

    byId("unmatchedToggle").addEventListener("click", function () {
      var expanded = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", expanded ? "false" : "true");
      byId("unmatchedBody").hidden = expanded;
    });
  }

  async function loadJson(path) {
    var response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(path + " 加载失败");
    return response.json();
  }

  async function start() {
    try {
      var embedded = window.HAYDAY_CATALOG_MAPPING_DATA;
      var loaded = embedded && embedded.reference && embedded.local
        ? [embedded.reference, embedded.local]
        : await Promise.all([
            loadJson("./catalog-reference.json"),
            loadJson("./catalog-local-base.json")
          ]);
      state.reference = loaded[0];
      state.base = loaded[1];
      state.local = clone(state.base);
      readDraft();
      await readExportedMappingWhenDraftIsEmpty();
      bindEvents();
      renderAll();
      if (state.loadedMappingName) {
        byId("saveIndicator").textContent = "已载入导出的完整对照表";
      }
    } catch (error) {
      byId("catalogList").innerHTML =
        '<div class="empty-state"><strong>工作台资料加载失败</strong><span>' +
        escapeHtml(error.message) +
        "。请确认页面旁边的目录数据文件完整。</span></div>";
      byId("pager").hidden = true;
      console.error(error);
    }
  }

  start();
})();
