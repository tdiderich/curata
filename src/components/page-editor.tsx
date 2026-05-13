"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

let _nextId = 0;
const nextId = () => "eid-" + _nextId++;

interface ComponentData {
  type: string;
  _id?: string;
  [key: string]: unknown;
}

interface PageJson {
  title: string;
  shell: string;
  subtitle?: string;
  components: ComponentData[];
}

const COMPONENT_TYPES = [
  { type: "markdown", label: "Text" },
  { type: "header", label: "Header" },
  { type: "callout", label: "Callout" },
  { type: "card_grid", label: "Cards" },
  { type: "stat_grid", label: "Stats" },
  { type: "steps", label: "Steps" },
  { type: "code", label: "Code" },
  { type: "image", label: "Image" },
  { type: "divider", label: "Divider" },
  { type: "table", label: "Table" },
] as const;

const COMPONENT_ICONS: Record<string, string> = {
  markdown: "Aa",
  header: "H",
  callout: "!",
  card_grid: ":::",
  stat_grid: "#",
  steps: "1.",
  code: "</>",
  image: "img",
  divider: "---",
  table: "|||",
};

const COMPONENT_DESCS: Record<string, string> = {
  markdown: "Rich text paragraph",
  header: "Section heading",
  callout: "Highlighted message",
  card_grid: "Grid of content cards",
  stat_grid: "Key metrics display",
  steps: "Numbered instructions",
  code: "Syntax-highlighted code",
  image: "Image with caption",
  divider: "Visual separator",
  table: "Data table",
};

function newComponent(type: string): ComponentData {
  switch (type) {
    case "markdown":
      return { type: "markdown", _id: nextId(), body: "" };
    case "header":
      return { type: "header", _id: nextId(), title: "" };
    case "callout":
      return { type: "callout", _id: nextId(), body: "", variant: "info" };
    case "card_grid":
      return { type: "card_grid", _id: nextId(), cards: [{ _id: nextId(), title: "", body: "" }] };
    case "stat_grid":
      return { type: "stat_grid", _id: nextId(), stats: [{ _id: nextId(), value: "", label: "" }] };
    case "steps":
      return { type: "steps", _id: nextId(), items: [{ _id: nextId(), title: "", body: "" }], numbered: true };
    case "code":
      return { type: "code", _id: nextId(), code: "", language: "" };
    case "image":
      return { type: "image", _id: nextId(), src: "", alt: "" };
    case "divider":
      return { type: "divider", _id: nextId() };
    case "table":
      return {
        type: "table",
        _id: nextId(),
        columns: [{ key: "col1", label: "Column 1" }],
        rows: [{ _id: nextId(), col1: "" }],
      };
    default:
      return { type, _id: nextId(), body: "" };
  }
}

function ComponentEditor({
  comp,
  index,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  comp: ComponentData;
  index: number;
  onChange: (index: number, data: ComponentData) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const update = (fields: Partial<ComponentData>) =>
    onChange(index, { ...comp, ...fields });

  const label = COMPONENT_TYPES.find((t) => t.type === comp.type)?.label ?? comp.type;

  return (
    <div className="pe-component">
      <div className="pe-component-header">
        <span className="pe-component-type">{label}</span>
        <div className="pe-component-actions">
          {!isFirst && (
            <button className="pe-move-btn" onClick={() => onMove(index, -1)} title="Move up">
              &uarr;
            </button>
          )}
          {!isLast && (
            <button className="pe-move-btn" onClick={() => onMove(index, 1)} title="Move down">
              &darr;
            </button>
          )}
          <button className="pe-remove-btn" onClick={() => onRemove(index)}>
            &times;
          </button>
        </div>
      </div>
      <div className="pe-component-body">
        {comp.type === "markdown" && (
          <textarea
            className="pe-textarea"
            placeholder="Markdown content..."
            value={(comp.body as string) || ""}
            onChange={(e) => update({ body: e.target.value })}
            rows={4}
          />
        )}
        {comp.type === "header" && (
          <>
            <input
              className="pe-input"
              placeholder="Heading text"
              value={(comp.title as string) || ""}
              onChange={(e) => update({ title: e.target.value })}
            />
            <input
              className="pe-input"
              placeholder="Subtitle (optional)"
              value={(comp.subtitle as string) || ""}
              onChange={(e) => update({ subtitle: e.target.value || undefined })}
            />
          </>
        )}
        {comp.type === "callout" && (
          <>
            <select
              className="pe-select"
              value={(comp.variant as string) || "info"}
              onChange={(e) => update({ variant: e.target.value })}
            >
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="success">Success</option>
              <option value="danger">Danger</option>
            </select>
            <input
              className="pe-input"
              placeholder="Title (optional)"
              value={(comp.title as string) || ""}
              onChange={(e) => update({ title: e.target.value || undefined })}
            />
            <textarea
              className="pe-textarea"
              placeholder="Callout body..."
              value={(comp.body as string) || ""}
              onChange={(e) => update({ body: e.target.value })}
              rows={3}
            />
          </>
        )}
        {comp.type === "code" && (
          <>
            <input
              className="pe-input"
              placeholder="Language (e.g. python, javascript)"
              value={(comp.language as string) || ""}
              onChange={(e) => update({ language: e.target.value || undefined })}
            />
            <textarea
              className="pe-textarea pe-textarea-code"
              placeholder="Code..."
              value={(comp.code as string) || ""}
              onChange={(e) => update({ code: e.target.value })}
              rows={6}
            />
          </>
        )}
        {comp.type === "image" && (
          <>
            <input
              className="pe-input"
              placeholder="Image URL"
              value={(comp.src as string) || ""}
              onChange={(e) => update({ src: e.target.value })}
            />
            <input
              className="pe-input"
              placeholder="Alt text"
              value={(comp.alt as string) || ""}
              onChange={(e) => update({ alt: e.target.value || undefined })}
            />
            <input
              className="pe-input"
              placeholder="Caption (optional)"
              value={(comp.caption as string) || ""}
              onChange={(e) => update({ caption: e.target.value || undefined })}
            />
          </>
        )}
        {comp.type === "card_grid" && (
          <CardGridEditor
            cards={(comp.cards as Array<{ title: string; body?: string }>) || []}
            onChange={(cards) => update({ cards })}
          />
        )}
        {comp.type === "stat_grid" && (
          <StatGridEditor
            stats={(comp.stats as Array<{ value: string; label: string }>) || []}
            onChange={(stats) => update({ stats })}
          />
        )}
        {comp.type === "steps" && (
          <StepsEditor
            items={(comp.items as Array<{ title: string; body?: string }>) || []}
            onChange={(items) => update({ items })}
          />
        )}
        {comp.type === "divider" && (
          <span className="pe-divider-label">Horizontal divider</span>
        )}
        {comp.type === "table" && (
          <TableEditor
            columns={(comp.columns as Array<{ key: string; label: string }>) || []}
            rows={(comp.rows as Array<Record<string, unknown>>) || []}
            onChange={(columns, rows) => update({ columns, rows })}
          />
        )}
      </div>
    </div>
  );
}

function CardGridEditor({
  cards,
  onChange,
}: {
  cards: Array<{ _id?: string; title: string; body?: string }>;
  onChange: (cards: Array<{ _id?: string; title: string; body?: string }>) => void;
}) {
  return (
    <div className="pe-list-editor">
      {cards.map((card, i) => (
        <div key={card._id ?? i} className="pe-list-item">
          <input
            className="pe-input"
            placeholder="Card title"
            value={card.title}
            onChange={(e) => {
              const next = [...cards];
              next[i] = { ...card, title: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="pe-input"
            placeholder="Card body"
            value={card.body || ""}
            onChange={(e) => {
              const next = [...cards];
              next[i] = { ...card, body: e.target.value || undefined };
              onChange(next);
            }}
          />
          {cards.length > 1 && (
            <button
              className="pe-list-remove"
              onClick={() => onChange(cards.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        className="pe-list-add"
        onClick={() => onChange([...cards, { _id: nextId(), title: "", body: "" }])}
      >
        + Add card
      </button>
    </div>
  );
}

function StatGridEditor({
  stats,
  onChange,
}: {
  stats: Array<{ value: string; label: string }>;
  onChange: (stats: Array<{ value: string; label: string }>) => void;
}) {
  return (
    <div className="pe-list-editor">
      {stats.map((stat, i) => (
        <div key={i} className="pe-list-item pe-list-item-row">
          <input
            className="pe-input pe-input-short"
            placeholder="Value"
            value={stat.value}
            onChange={(e) => {
              const next = [...stats];
              next[i] = { ...stat, value: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="pe-input"
            placeholder="Label"
            value={stat.label}
            onChange={(e) => {
              const next = [...stats];
              next[i] = { ...stat, label: e.target.value };
              onChange(next);
            }}
          />
          {stats.length > 1 && (
            <button
              className="pe-list-remove"
              onClick={() => onChange(stats.filter((_, j) => j !== i))}
            >
              &times;
            </button>
          )}
        </div>
      ))}
      <button
        className="pe-list-add"
        onClick={() => onChange([...stats, { value: "", label: "" }])}
      >
        + Add stat
      </button>
    </div>
  );
}

function StepsEditor({
  items,
  onChange,
}: {
  items: Array<{ title: string; body?: string }>;
  onChange: (items: Array<{ title: string; body?: string }>) => void;
}) {
  return (
    <div className="pe-list-editor">
      {items.map((item, i) => (
        <div key={i} className="pe-list-item">
          <input
            className="pe-input"
            placeholder={`Step ${i + 1} title`}
            value={item.title}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, title: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="pe-input"
            placeholder="Description (optional)"
            value={item.body || ""}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, body: e.target.value || undefined };
              onChange(next);
            }}
          />
          {items.length > 1 && (
            <button
              className="pe-list-remove"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        className="pe-list-add"
        onClick={() => onChange([...items, { title: "", body: "" }])}
      >
        + Add step
      </button>
    </div>
  );
}

function TableEditor({
  columns,
  rows,
  onChange,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  onChange: (
    columns: Array<{ key: string; label: string }>,
    rows: Array<Record<string, unknown>>
  ) => void;
}) {
  const addColumn = () => {
    const key = `col${columns.length + 1}`;
    const newCols = [...columns, { key, label: `Column ${columns.length + 1}` }];
    const newRows = rows.map((r) => ({ ...r, [key]: "" }));
    onChange(newCols, newRows);
  };

  const addRow = () => {
    const empty: Record<string, unknown> = {};
    for (const col of columns) empty[col.key] = "";
    onChange(columns, [...rows, empty]);
  };

  return (
    <div className="pe-table-editor">
      <div className="pe-table-grid" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr) 32px` }}>
        {columns.map((col, ci) => (
          <input
            key={`h-${ci}`}
            className="pe-input pe-table-header"
            value={col.label}
            onChange={(e) => {
              const next = [...columns];
              next[ci] = { ...col, label: e.target.value };
              onChange(next, rows);
            }}
          />
        ))}
        <span />
        {rows.map((row, ri) => (
          <>
            {columns.map((col, ci) => (
              <input
                key={`${ri}-${ci}`}
                className="pe-input"
                value={(row[col.key] as string) || ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[ri] = { ...row, [col.key]: e.target.value };
                  onChange(columns, next);
                }}
              />
            ))}
            <button
              key={`rm-${ri}`}
              className="pe-list-remove"
              onClick={() => onChange(columns, rows.filter((_, j) => j !== ri))}
            >
              &times;
            </button>
          </>
        ))}
      </div>
      <div className="pe-table-actions">
        <button className="pe-list-add" onClick={addRow}>+ Row</button>
        <button className="pe-list-add" onClick={addColumn}>+ Column</button>
      </div>
    </div>
  );
}

export default function PageEditor({
  slug,
  initial,
  contentHash,
}: {
  slug: string;
  initial: PageJson;
  contentHash: string;
}) {
  const router = useRouter();
  const [page, setPage] = useState<PageJson>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const updateComponent = useCallback((index: number, data: ComponentData) => {
    setPage((p) => {
      const comps = [...p.components];
      comps[index] = data;
      return { ...p, components: comps };
    });
  }, []);

  const removeComponent = useCallback((index: number) => {
    setPage((p) => ({
      ...p,
      components: p.components.filter((_, i) => i !== index),
    }));
  }, []);

  const moveComponent = useCallback((index: number, direction: -1 | 1) => {
    setPage((p) => {
      const comps = [...p.components];
      const target = index + direction;
      if (target < 0 || target >= comps.length) return p;
      [comps[index], comps[target]] = [comps[target], comps[index]];
      return { ...p, components: comps };
    });
  }, []);

  const addComponent = useCallback((type: string) => {
    setPage((p) => ({
      ...p,
      components: [...p.components, newComponent(type)],
    }));
    setAddMenuOpen(false);
  }, []);

  async function save() {
    setSaving(true);
    setError("");

    const clean = {
      ...page,
      components: page.components.map((c) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c)) {
          if (v !== undefined && v !== "") out[k] = v;
        }
        return out;
      }),
    };

    try {
      const res = await fetch(`${basePath}/api/pages/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          json: clean,
          expectedHash: contentHash,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }

      setSaving(false);
      router.push(`/pages/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSaving(false);
    }
  }

  return (
    <div className="pe-root">
      <div className="pe-meta">
        <input
          className="pe-input pe-input-title"
          autoFocus
          placeholder="Untitled"
          value={page.title}
          onChange={(e) => setPage({ ...page, title: e.target.value })}
        />
        <input
          className="pe-input pe-input-subtitle"
          placeholder="Add a subtitle..."
          value={page.subtitle || ""}
          onChange={(e) =>
            setPage({ ...page, subtitle: e.target.value || undefined })
          }
        />
      </div>

      <div className="pe-components">
        {page.components.map((comp, i) => (
          <ComponentEditor
            key={comp._id ?? i}
            comp={comp}
            index={i}
            onChange={updateComponent}
            onRemove={removeComponent}
            onMove={moveComponent}
            isFirst={i === 0}
            isLast={i === page.components.length - 1}
          />
        ))}
      </div>

      <div className="pe-add-wrap">
        <button
          className="pe-add-btn"
          onClick={() => setAddMenuOpen(!addMenuOpen)}
        >
          {page.components.length === 0
            ? "Click to add your first block..."
            : "+ Add block"}
        </button>
        {addMenuOpen && (
          <div className="pe-add-menu">
            {COMPONENT_TYPES.map((t) => (
              <button
                key={t.type}
                className="pe-add-option"
                onClick={() => addComponent(t.type)}
              >
                <span className="pe-add-option-icon">{COMPONENT_ICONS[t.type] || "+"}</span>
                <span>
                  <span className="pe-add-option-label">{t.label}</span>
                  <span className="pe-add-option-desc">{COMPONENT_DESCS[t.type] || ""}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pe-footer">
        <button
          className="pe-save-btn"
          onClick={save}
          disabled={saving || !page.title.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {error && <span className="pe-error">{error}</span>}
      </div>
    </div>
  );
}
