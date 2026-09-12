import {
  ROUTE_STATUSES,
  routeColor,
  STATUS_LABELS,
  VESSEL_TYPE_LABELS,
  VESSEL_TYPES,
} from "../domain/labels.ts";
import type { RouteStatus, VesselType } from "../domain/publicData.ts";
import type { RouteFilter } from "../domain/routeFilter.ts";
import { h } from "./dom.ts";

export interface FilterPanel {
  element: HTMLElement;
  /** 表示中の航路の数を更新する。 */
  setVisibleCount(count: number, total: number): void;
}

function swatch(color: string, dashed = false): HTMLElement {
  const el = h("span", {
    class: dashed ? "swatch swatch--dashed" : "swatch",
    "aria-hidden": "true",
  });
  el.style.setProperty("--swatch-color", color);
  return el;
}

function checkbox(
  name: string,
  value: string,
  label: string,
  color: string,
  checked: boolean,
): HTMLLabelElement {
  return h(
    "label",
    { class: "check" },
    h("input", { type: "checkbox", name, value, checked }),
    swatch(color),
    label,
  );
}

/**
 * 画面左上の絞り込みパネル（凡例を兼ねる）。スマホでは畳んだ状態で始める。
 */
export function createFilterPanel(
  operators: readonly string[],
  initial: RouteFilter,
  onChange: (filter: RouteFilter) => void,
): FilterPanel {
  const count = h("p", { class: "panel__count", "aria-live": "polite" });
  const operatorSelect = h(
    "select",
    { name: "operator", id: "filter-operator" },
    h("option", { value: "" }, "すべての運航会社"),
    ...operators.map((operator) => h("option", { value: operator }, operator)),
  );

  const form = h(
    "form",
    { class: "panel__body", id: "filter-panel-body" },
    h(
      "fieldset",
      {},
      h("legend", {}, "船種"),
      ...VESSEL_TYPES.map((type) =>
        checkbox(
          "vesselType",
          type,
          VESSEL_TYPE_LABELS[type],
          routeColor(type, "operating"),
          initial.vesselTypes.has(type),
        ),
      ),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "運航状態"),
      ...ROUTE_STATUSES.map((status) =>
        checkbox(
          "status",
          status,
          STATUS_LABELS[status],
          status === "suspended" ? routeColor("ferry", status) : "#14213D",
          initial.statuses.has(status),
        ),
      ),
    ),
    h("label", { class: "field", for: "filter-operator" }, "運航会社"),
    operatorSelect,
    h(
      "p",
      { class: "panel__note" },
      swatch("#14213D", true),
      "点線は、海上の最短経路として計算した推定の線です。実際の航路とは異なることがあります。",
    ),
  );

  const compact = window.matchMedia("(max-width: 640px)").matches;
  const toggle = h(
    "button",
    {
      type: "button",
      class: "panel__toggle",
      "aria-expanded": String(!compact),
      "aria-controls": "filter-panel-body",
    },
    "絞り込み",
  );
  form.hidden = compact;
  toggle.addEventListener("click", () => {
    form.hidden = !form.hidden;
    toggle.setAttribute("aria-expanded", String(!form.hidden));
  });

  form.addEventListener("change", () => {
    const data = new FormData(form);
    onChange({
      vesselTypes: new Set(data.getAll("vesselType") as VesselType[]),
      statuses: new Set(data.getAll("status") as RouteStatus[]),
      operator: (data.get("operator") as string) || null,
    });
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  operatorSelect.value = initial.operator ?? "";

  const element = h(
    "section",
    { class: "panel", "aria-label": "航路の絞り込み" },
    h(
      "header",
      { class: "panel__header" },
      h("h1", { class: "panel__title" }, "日本フェリー航路マップ"),
      toggle,
    ),
    // 表示中の航路数は、絞り込みを畳んでいるときも読めるようにフォームの外に置く
    count,
    form,
  );

  return {
    element,
    setVisibleCount(visible, total) {
      count.textContent =
        visible === total
          ? `${total} 航路を表示しています`
          : `${total} 航路のうち ${visible} 航路を表示しています`;
    },
  };
}
