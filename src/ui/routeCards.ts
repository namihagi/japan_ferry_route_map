import { formatDuration, routeColor, STATUS_LABELS, VESSEL_TYPE_LABELS } from "../domain/labels.ts";
import type { RouteDetail } from "../domain/publicData.ts";
import { h } from "./dom.ts";

function withRouteColor<T extends HTMLElement>(el: T, route: RouteDetail): T {
  el.style.setProperty("--route-color", routeColor(route.vesselType, route.status));
  return el;
}

/** 航路の詳細。乗船券に見立て、寄港地を停留所のように縦に並べる。 */
export function routeTicket(route: RouteDetail): HTMLElement {
  const suspended = route.status === "suspended";
  return withRouteColor(
    h(
      "article",
      { class: "ticket", "aria-label": `${route.name}（${route.operator}）` },
      h(
        "header",
        { class: "ticket__header" },
        h("p", { class: "ticket__type" }, VESSEL_TYPE_LABELS[route.vesselType]),
        h("h2", { class: "ticket__name" }, route.name),
        h("p", { class: "ticket__operator" }, route.operator),
      ),
      h(
        "ol",
        { class: "stops", "aria-label": "寄港地" },
        ...route.portsOfCall.map((port) => h("li", { class: "stops__port" }, port.name)),
      ),
      h(
        "footer",
        { class: "ticket__footer" },
        h(
          "p",
          { class: "ticket__facts" },
          h(
            "span",
            { class: suspended ? "status status--suspended" : "status" },
            STATUS_LABELS[route.status],
          ),
          route.seasonal && h("span", {}, "季節運航"),
          route.durationMinutes !== undefined &&
            h("span", {}, `所要 ${formatDuration(route.durationMinutes)}`),
        ),
        route.hasEstimatedLegs &&
          h(
            "p",
            { class: "ticket__note" },
            "点線の区間は推定の線で、実際の航路とは異なることがあります。",
          ),
        h(
          "a",
          { class: "ticket__link", href: route.officialUrl, target: "_blank", rel: "noopener" },
          "運航会社のサイトで運航情報を見る",
        ),
      ),
    ),
    route,
  );
}

/** 航路を選ぶためのボタンの一覧（重なった線をクリックしたときや、港を選んだとき）。 */
export function routeChoices(
  heading: string,
  routes: readonly RouteDetail[],
  onPick: (route: RouteDetail) => void,
): HTMLElement {
  return h(
    "section",
    { class: "choices" },
    h("h2", { class: "choices__heading" }, heading),
    routes.length === 0 &&
      h(
        "p",
        { class: "choices__empty" },
        "絞り込みの条件に合う航路はありません。条件を広げてください。",
      ),
    routes.length > 0 &&
      h(
        "ul",
        { class: "choices__list" },
        ...routes.map((route) => {
          const button = withRouteColor(
            h(
              "button",
              { type: "button", class: "choice" },
              h("span", { class: "choice__name" }, route.name),
              h(
                "span",
                { class: "choice__operator" },
                `${route.operator}（${VESSEL_TYPE_LABELS[route.vesselType]}）`,
              ),
            ),
            route,
          );
          button.addEventListener("click", () => onPick(route));
          return h("li", {}, button);
        }),
      ),
  );
}
