// 금융소득 2,000만원 판정기.
//
// 매년 뉴스에 나오는 숫자인데 정작 "그래서 나한테 얼마"를 알려주는 게 없다.
// 게다가 문턱이 하나가 아니다. 세금은 2,000만원, 건강보험은 1,000만원과
// 2,000만원 두 개가 따로 돈다. 이걸 한 화면에서 본 적이 없다.
//
// 세금 쪽 핵심은 비교과세다. 2,000만원을 넘겼다고 전액에 누진세율이
// 붙는 게 아니라, 종합과세와 분리과세를 계산해 큰 쪽을 낸다. 그래서
// 넘겼는데도 추가 세금이 0원인 경우가 흔하다. 이걸 모르고 겁먹는다.
//
// 근거: 소득세법 제62조(비교과세), 제55조(세율), 국민건강보험법 시행령

(function () {
  "use strict";

  // ── 기준값 ────────────────────────────────────────────────

  var THRESHOLD = 20000000;        // 금융소득 종합과세 기준
  var WITHHOLD_RATE = 0.14;        // 원천징수세율 (지방소득세 1.4% 별도)
  var LOCAL_RATE = 0.1;            // 지방소득세는 소득세액의 10%
  var DEFAULT_DEDUCT = 1500000;    // 본인 기본공제만 잡은 값

  // 건강보험 문턱. 세금과 숫자가 달라서 사람들이 제일 많이 헷갈린다.
  var HEALTH_LOCAL = 10000000;     // 지역가입자: 금융소득이 이걸 넘으면 전액 보험료 산정에 포함
  var HEALTH_DEPENDENT = 20000000; // 피부양자: 합산소득이 이걸 넘으면 탈락
  var HEALTH_EMPLOYEE = 20000000;  // 직장가입자: 보수외소득이 이걸 넘으면 소득월액보험료

  // 종합소득세 기본세율 (소득세법 제55조). [상한, 세율, 누진공제]
  var BRACKETS = [
    [14000000,   0.06, 0],
    [50000000,   0.15, 1260000],
    [88000000,   0.24, 5760000],
    [150000000,  0.35, 15440000],
    [300000000,  0.38, 19940000],
    [500000000,  0.40, 25940000],
    [1000000000, 0.42, 35940000],
    [Infinity,   0.45, 65940000],
  ];

  // ── 계산 ──────────────────────────────────────────────────

  function progressive(base) {
    if (base <= 0) return { tax: 0, rate: 0 };
    for (var i = 0; i < BRACKETS.length; i += 1) {
      if (base <= BRACKETS[i][0]) {
        return { tax: base * BRACKETS[i][1] - BRACKETS[i][2], rate: BRACKETS[i][1] };
      }
    }
    return { tax: 0, rate: 0 };
  }

  function calculate(i) {
    var fin = i.financial;
    var other = i.other;
    var deduct = i.deduct > 0 ? i.deduct : DEFAULT_DEDUCT;
    var over = fin > THRESHOLD;

    var withheld = fin * WITHHOLD_RATE;

    // 2,000만원 이하면 원천징수로 끝난다. 신고할 것도 없다.
    if (!over) {
      return {
        financial: fin, other: other, over: false,
        withheld: withheld, extra: 0, extraLocal: 0, extraTotal: 0,
        health: health(i, fin),
      };
    }

    // 비교과세. 둘 중 큰 쪽이 산출세액이다.
    //   종합과세: 2,000만원까지는 14% 로 두고, 초과분만 다른 소득과 합쳐 누진
    //   분리과세: 금융소득 전액을 14% 로 떼고, 다른 소득만 누진
    var baseA = Math.max(0, (fin - THRESHOLD) + other - deduct);
    var pa = progressive(baseA);
    var taxA = THRESHOLD * WITHHOLD_RATE + pa.tax;

    var baseB = Math.max(0, other - deduct);
    var pb = progressive(baseB);
    var taxB = fin * WITHHOLD_RATE + pb.tax;

    var tax = Math.max(taxA, taxB);
    var extra = Math.max(0, tax - withheld);

    return {
      financial: fin, other: other, deduct: deduct, over: true,
      excess: fin - THRESHOLD,
      baseA: baseA, taxA: taxA, marginal: pa.rate,
      baseB: baseB, taxB: taxB,
      chosen: taxA >= taxB ? "종합과세" : "분리과세",
      tax: tax,
      withheld: withheld,
      extra: extra,
      extraLocal: extra * LOCAL_RATE,
      extraTotal: extra * (1 + LOCAL_RATE),
      health: health(i, fin),
    };
  }

  // 건강보험 영향. 세금과 문턱이 다르다.
  function health(i, fin) {
    if (i.insured === "dependent") {
      var total = fin + i.other;
      return {
        kind: "피부양자",
        hit: total > HEALTH_DEPENDENT,
        line: HEALTH_DEPENDENT,
        text: total > HEALTH_DEPENDENT
          ? "합산소득이 연 2,000만원을 넘어 피부양자에서 탈락합니다. 지역가입자로 바뀌어 소득과 재산에 보험료가 붙습니다"
          : "합산소득이 연 2,000만원 이하라 자격이 유지될 것으로 보입니다",
      };
    }
    if (i.insured === "local") {
      return {
        kind: "지역가입자",
        hit: fin > HEALTH_LOCAL,
        line: HEALTH_LOCAL,
        text: fin > HEALTH_LOCAL
          ? "금융소득이 연 1,000만원을 넘어 <strong>전액</strong>이 보험료 산정 소득에 들어갑니다. 1,001만원이 되는 순간 1,000만원 전부가 잡힙니다"
          : "금융소득이 연 1,000만원 이하라 보험료 산정에 안 들어갑니다",
      };
    }
    return {
      kind: "직장가입자",
      hit: fin > HEALTH_EMPLOYEE,
      line: HEALTH_EMPLOYEE,
      text: fin > HEALTH_EMPLOYEE
        ? "보수 외 소득이 연 2,000만원을 넘어 초과분에 소득월액보험료가 따로 붙습니다"
        : "보수 외 소득이 연 2,000만원 이하라 추가 보험료는 없습니다",
    };
  }

  // ── 화면 ──────────────────────────────────────────────────

  function won(n) { return Math.round(n).toLocaleString("ko-KR") + "원"; }

  function render(r) {
    var box = document.getElementById("calc-result");
    var html = "";

    html += '<p class="calc-label">금융소득 ' + won(r.financial) + "</p>";
    if (!r.over) {
      html += '<p class="calc-amount">추가 세금 없습니다</p>';
      html += '<p class="calc-sub">2,000만원 이하라 원천징수로 끝납니다</p>';
    } else if (r.extraTotal === 0) {
      html += '<p class="calc-amount">추가 세금 없습니다</p>';
      html += '<p class="calc-sub">종합과세 대상이지만 비교과세로 세액이 안 늘었습니다</p>';
    } else {
      html += '<p class="calc-amount">약 ' + won(r.extraTotal) + " 더</p>";
      html += '<p class="calc-sub">지방소득세까지 더한 추가 납부액입니다</p>';
    }

    html += '<ul class="calc-checklist">';
    html += '<li class="' + (r.over ? "warn" : "pass") + '"><strong>세금 · 2,000만원 기준</strong><span>' +
            (r.over
              ? "종합과세 대상입니다. 다만 아래를 보세요"
              : "이하라 15.4% 원천징수로 끝납니다. 따로 신고할 것도 없습니다") + "</span></li>";
    html += '<li class="' + (r.health.hit ? "fail" : "pass") + '"><strong>건강보험 · ' + r.health.kind +
            "</strong><span>" + r.health.text + "</span></li>";
    html += "</ul>";

    if (r.over) {
      html += '<div class="calc-breakdown"><h4>비교과세: 큰 쪽을 냅니다</h4><ul>';
      html += '<li><span class="bd-label">종합과세로 계산</span><span class="bd-value">' + won(r.taxA) +
              '</span><span class="bd-note">2,000만원 × 14% + (초과 ' + won(r.excess) +
              " + 다른 소득 − 공제)에 누진세율. 과세표준 " + won(r.baseA) +
              " 이면 한계세율 " + Math.round(r.marginal * 100) + "%</span></li>";
      html += '<li><span class="bd-label">분리과세로 계산</span><span class="bd-value">' + won(r.taxB) +
              '</span><span class="bd-note">금융소득 전액 × 14% + 다른 소득에만 누진세율</span></li>';
      html += '<li><span class="bd-label">산출세액 (' + r.chosen + ')</span><span class="bd-value">' +
              won(r.tax) + '</span><span class="bd-note">둘 중 큰 쪽입니다</span></li>';
      html += '<li><span class="bd-label">이미 낸 원천징수</span><span class="bd-value">− ' + won(r.withheld) +
              '</span><span class="bd-note">금융소득 × 14%. 받을 때 이미 떼였습니다</span></li>';
      html += '<li><span class="bd-label">추가 납부</span><span class="bd-value"><strong>' + won(r.extraTotal) +
              '</strong></span><span class="bd-note">소득세 ' + won(r.extra) + " + 지방소득세 " +
              won(r.extraLocal) + "</span></li>";
      html += "</ul></div>";
    }

    html += '<ul class="calc-notes">';
    if (r.over && r.extraTotal === 0) {
      html += "<li><strong>넘겼는데 왜 세금이 안 느나요.</strong> 비교과세 때문입니다. 종합과세로 계산한 값이 분리과세보다 작으면 분리과세 쪽을 냅니다. 다른 소득이 적으면 금융소득만으로는 약 8,000만원까지도 추가 세금이 안 나옵니다. <strong>2,000만원을 넘었다는 것과 세금이 는다는 것은 다른 이야기입니다</strong></li>";
    }
    if (r.over) {
      html += "<li>다음 해 <strong>5월에 종합소득세를 신고</strong>해야 합니다. 추가 세금이 0원이어도 신고 의무는 생깁니다</li>";
    }
    html += "<li><strong>세금과 건강보험은 문턱이 다릅니다.</strong> 세금은 2,000만원 하나지만, 건강보험은 지역가입자 1,000만원과 피부양자 2,000만원 두 개가 따로 돕니다. 세금은 안 늘어도 건강보험료가 뛰는 경우가 여기서 나옵니다</li>";
    if (r.health.kind === "지역가입자" && r.health.hit) {
      html += "<li>지역가입자의 1,000만원 기준은 <strong>계단</strong>입니다. 초과분만 잡는 게 아니라 1원이라도 넘으면 전액이 들어갑니다. 999만원과 1,001만원의 차이가 큽니다</li>";
    }
    if (r.health.kind === "피부양자" && r.health.hit) {
      html += '<li>피부양자 탈락 여부는 소득 말고 재산과 관계 요건도 함께 봅니다. <a href="https://leisurely.importants-studio.com/tools/dependent-check/">피부양자 자격 판정기</a>에서 항목별로 확인하실 수 있습니다</li>';
    }
    html += "<li>비과세·분리과세 상품(ISA, 비과세 종합저축, 브라질 국채 등)은 이 2,000만원 계산에 안 들어갑니다</li>";
    html += "<li>배당가산액(그로스업)은 반영하지 않았습니다. 국내 법인 배당이 많으면 실제 세액이 이보다 조금 높게 나올 수 있습니다</li>";
    html += "</ul>";

    html += '<div class="calc-actions">';
    html += '<a class="calc-btn primary" href="https://www.hometax.go.kr" target="_blank" rel="noopener">홈택스에서 내 금융소득 조회</a>';
    html += "</div>";

    html += '<div class="calc-share">';
    html += '<span class="calc-share-label">결과 공유하기</span>';
    html += '<div class="calc-share-btns">';
    html += '<button class="share-btn kakao" type="button" data-share="native">카카오톡·메시지</button>';
    html += '<button class="share-btn x" type="button" data-share="x">X</button>';
    html += '<button class="share-btn link" type="button" data-share="copy">링크 복사</button>';
    html += "</div></div>";

    html += '<p class="calc-disclaimer">소득세법 제55조의 기본세율과 제62조의 비교과세를 반영한 <strong>간이 계산</strong>입니다. 배당가산액, 세액공제, 감면은 반영하지 않았습니다. 실제 세액은 소득 구성과 공제 항목에 따라 달라지므로 홈택스 모의계산이나 세무 상담으로 확인하세요. 이 도구는 특정 금융상품이나 투자 판단을 권유하지 않습니다.</p>';

    box.innerHTML = html;
    box.hidden = false;
    if (window.gtag) gtag("event", "tool_result", { tool_path: location.pathname });

    var url = "https://money.importants-studio.com/tools/financial-income-tax/";
    var shareText = r.extraTotal > 0
      ? "금융소득 " + won(r.financial) + "이면 세금이 " + won(r.extraTotal) + " 더 붙는다고 합니다 (돈의문법 판정기)"
      : "금융소득 " + won(r.financial) + "이면 추가 세금이 없다고 합니다 (돈의문법 판정기)";

    box.querySelectorAll("[data-share]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-share");
        if (mode === "native") {
          if (navigator.share) {
            navigator.share({ title: "금융소득 종합과세 계산기", text: shareText, url: url }).catch(function () {});
          } else {
            copyTo(btn, shareText + "\n" + url, "복사됨 (카톡에 붙여넣기)");
          }
        } else if (mode === "x") {
          window.open(
            "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(url),
            "_blank", "noopener"
          );
        } else {
          copyTo(btn, url, "링크 복사됨");
        }
      });
    });

    function copyTo(btn, text, done) {
      var original = btn.textContent;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = done;
        setTimeout(function () { btn.textContent = original; }, 2000);
      });
    }

    if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── 입력 ──────────────────────────────────────────────────

  function num(el) {
    if (!el) return 0;
    var v = parseInt(String(el.value).replace(/[,\s원]/g, ""), 10);
    return isNaN(v) || v < 0 ? 0 : v;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("financial-income-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      render(calculate({
        financial: num(form.elements.financial),
        other: num(form.elements.other),
        deduct: num(form.elements.deduct),
        insured: form.elements.insured.value,
      }));
    });
  });

  window.__financialIncomeTax = {
    calculate: calculate, progressive: progressive, health: health,
    THRESHOLD: THRESHOLD, BRACKETS: BRACKETS,
    HEALTH_LOCAL: HEALTH_LOCAL, HEALTH_DEPENDENT: HEALTH_DEPENDENT,
  };
})();
