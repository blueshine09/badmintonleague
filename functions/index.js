const functions = require("firebase-functions");
const fetch = require("node-fetch");

/* =========================
   공통 유틸
========================= */

function getApiKey() {
  return (
    (functions.config().openai && functions.config().openai.key) ||
    process.env.OPENAI_API_KEY
  );
}

function normalizeArray(arr) {
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function stringifySafe(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (error) {
    return "{}";
  }
}

async function callOpenAI(prompt) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const result = await response.json();

  return (
    result.output_text ||
    result.output?.[0]?.content?.[0]?.text ||
    ""
  );
}

/* =========================
   프롬프트 생성기
========================= */

function buildOrderRecommendationPrompt({ lineup, stats }) {
  return `
너는 고등학교 체육수업용 배드민턴 오더 추천 코치다.
학생이 실제로 오더를 정하는 데 바로 도움이 되도록 매우 구체적으로 추천하라.

목표:
- 상대 팀의 종목별 예상 출전 조합을 추정한다.
- 우리 팀의 종목별 추천 출전 조합을 제안한다.
- 추천 이유를 선수별 강점, 약점, 최근 기록, 조합 특성을 근거로 설명한다.
- 대안 조합과 운영 팁까지 함께 제시한다.

작성 원칙:
1. 추상적인 표현(예: 열심히, 집중해, 흐름을 잡아라)은 금지한다.
2. 반드시 선수 이름을 언급한다.
3. 반드시 왜 이 조합이 유리한지 구체적으로 설명한다.
4. 상대 예상 조합은 최근 출전 빈도와 기록을 근거로 추정한다.
5. 추천 조합은 현재 입력된 선수 중에서만 고른다.
6. 각 종목(여복, 혼복, 남복)에 대해 하나의 추천 조합과 하나의 대안 조합을 제시한다.
7. 학생이 바로 오더를 수정할 수 있도록 실질적인 문장으로 작성한다.
8. 출력은 반드시 JSON만 한다.

우리 팀 정보:
- 승률: ${stats.myTeam.winRate}
- 득실차: ${stats.myTeam.scoreDiff}
- 팀 강점: ${(stats.myTeam.strengths || []).join(", ")}
- 팀 약점: ${(stats.myTeam.weaknesses || []).join(", ")}

우리 팀 선수 정보:
${stringifySafe(stats.myTeam.players)}

우리 팀 조합 정보:
${stringifySafe(stats.myTeam.pairs)}

상대 팀 정보:
- 승률: ${stats.opponentTeam.winRate}
- 득실차: ${stats.opponentTeam.scoreDiff}
- 팀 강점: ${(stats.opponentTeam.strengths || []).join(", ")}
- 팀 약점: ${(stats.opponentTeam.weaknesses || []).join(", ")}

상대 팀 선수 정보:
${stringifySafe(stats.opponentTeam.players)}

상대 팀 조합 정보:
${stringifySafe(stats.opponentTeam.pairs)}

현재 임시 오더:
- 여복: ${normalizeArray(lineup.women).join(", ")}
- 혼복: ${normalizeArray(lineup.mixed).join(", ")}
- 남복: ${normalizeArray(lineup.men).join(", ")}

출력 형식:
{
  "summary": {
    "overallRecommendation": "전체적으로 어떤 기준으로 오더를 짜는 것이 좋은지 한 문장으로 설명"
  },
  "predictions": {
    "women": {
      "expectedOppPair": ["선수A", "선수B"],
      "reason": "상대 여복 예상 근거"
    },
    "mixed": {
      "expectedOppPair": ["선수A", "선수B"],
      "reason": "상대 혼복 예상 근거"
    },
    "men": {
      "expectedOppPair": ["선수A", "선수B"],
      "reason": "상대 남복 예상 근거"
    }
  },
  "recommendations": {
    "women": {
      "recommendedPair": ["선수A", "선수B"],
      "reason": "왜 이 조합을 추천하는지",
      "alternativePair": ["선수C", "선수D"],
      "alternativeReason": "대안 조합 설명",
      "tip": "실제 경기 운영 팁"
    },
    "mixed": {
      "recommendedPair": ["선수A", "선수B"],
      "reason": "왜 이 조합을 추천하는지",
      "alternativePair": ["선수C", "선수D"],
      "alternativeReason": "대안 조합 설명",
      "tip": "실제 경기 운영 팁"
    },
    "men": {
      "recommendedPair": ["선수A", "선수B"],
      "reason": "왜 이 조합을 추천하는지",
      "alternativePair": ["선수C", "선수D"],
      "alternativeReason": "대안 조합 설명",
      "tip": "실제 경기 운영 팁"
    }
  }
}
`;
}

function buildMatchTacticsPrompt({ actualLineups, stats }) {
  return `
너는 고등학교 체육수업용 배드민턴 맞춤 전술 코치다.
상대 팀의 실제 출전 조합이 확정된 상태에서, 우리 팀이 바로 사용할 수 있는 맞춤 전술을 제안하라.

목표:
- 종목별로 상대 실제 조합의 역할과 패턴을 짧게 분석한다.
- 우리 실제 조합이 누구를 어떻게 공략해야 하는지 제시한다.
- 공략 포인트, 주의할 점, 첫 운영 팁을 구체적으로 제시한다.

작성 원칙:
1. 추상적인 표현(예: 열심히, 집중해, 안정적으로 해라)은 금지한다.
2. 반드시 선수 이름을 언급한다.
3. 반드시 상대 조합의 특징을 설명한다.
4. 반드시 우리 조합의 강점을 활용한 대응 방안을 제시한다.
5. 학생이 경기 직전에 읽고 바로 쓸 수 있는 문장으로 작성한다.
6. 각 종목(여복, 혼복, 남복)별로 작성한다.
7. 출력은 반드시 JSON만 한다.

우리 팀 실제 오더:
- 여복: ${normalizeArray(actualLineups.myTeam?.women).join(", ")}
- 혼복: ${normalizeArray(actualLineups.myTeam?.mixed).join(", ")}
- 남복: ${normalizeArray(actualLineups.myTeam?.men).join(", ")}

상대 팀 실제 오더:
- 여복: ${normalizeArray(actualLineups.opponentTeam?.women).join(", ")}
- 혼복: ${normalizeArray(actualLineups.opponentTeam?.mixed).join(", ")}
- 남복: ${normalizeArray(actualLineups.opponentTeam?.men).join(", ")}

우리 팀 선수 기록:
${stringifySafe(stats.myTeam.players)}

우리 팀 조합 기록:
${stringifySafe(stats.myTeam.pairs)}

상대 팀 선수 기록:
${stringifySafe(stats.opponentTeam.players)}

상대 팀 조합 기록:
${stringifySafe(stats.opponentTeam.pairs)}

출력 형식:
{
  "summary": {
    "overallPlan": "전체 경기 운영의 핵심 한 문장"
  },
  "women": {
    "ourPair": ["선수A", "선수B"],
    "oppPair": ["선수C", "선수D"],
    "oppStyle": "상대 조합의 특징 요약",
    "attackPoint": "우리가 노려야 할 공략 포인트",
    "warning": "주의할 점",
    "openingPlan": "첫 랠리 운영 팁"
  },
  "mixed": {
    "ourPair": ["선수A", "선수B"],
    "oppPair": ["선수C", "선수D"],
    "oppStyle": "상대 조합의 특징 요약",
    "attackPoint": "우리가 노려야 할 공략 포인트",
    "warning": "주의할 점",
    "openingPlan": "첫 랠리 운영 팁"
  },
  "men": {
    "ourPair": ["선수A", "선수B"],
    "oppPair": ["선수C", "선수D"],
    "oppStyle": "상대 조합의 특징 요약",
    "attackPoint": "우리가 노려야 할 공략 포인트",
    "warning": "주의할 점",
    "openingPlan": "첫 랠리 운영 팁"
  }
}
`;
}

/* =========================
   fallback: 오더 추천
========================= */

function buildFallbackOrderRecommendation(lineup) {
  return {
    summary: {
      overallRecommendation:
        "현재는 AI 서버 호출에 실패하여 기본 추천을 표시합니다. 이미 선택한 조합을 기준으로 안정적인 운영을 우선하는 것이 좋습니다."
    },
    predictions: {
      women: {
        expectedOppPair: ["상대 여복 1", "상대 여복 2"],
        reason: "상대 최근 오더 기록이 충분하지 않아 일반적인 예상 조합을 표시합니다."
      },
      mixed: {
        expectedOppPair: ["상대 혼복 여자", "상대 혼복 남자"],
        reason: "상대 최근 오더 기록이 충분하지 않아 일반적인 예상 조합을 표시합니다."
      },
      men: {
        expectedOppPair: ["상대 남복 1", "상대 남복 2"],
        reason: "상대 최근 오더 기록이 충분하지 않아 일반적인 예상 조합을 표시합니다."
      }
    },
    recommendations: {
      women: {
        recommendedPair: normalizeArray(lineup?.women),
        reason:
          "현재 선택된 여복 조합을 기준으로 수비 안정성과 연결 유지가 좋은 조합을 우선 고려합니다.",
        alternativePair: [],
        alternativeReason: "대안 조합 데이터가 충분하지 않습니다.",
        tip: "초반에는 무리한 공격보다 안정적인 랠리 유지에 집중합니다."
      },
      mixed: {
        recommendedPair: normalizeArray(lineup?.mixed),
        reason:
          "현재 선택된 혼복 조합을 기준으로 전위·후위 역할을 분명히 하는 운영이 적절합니다.",
        alternativePair: [],
        alternativeReason: "대안 조합 데이터가 충분하지 않습니다.",
        tip: "여자 선수는 연결 안정, 남자 선수는 후위 커버를 우선합니다."
      },
      men: {
        recommendedPair: normalizeArray(lineup?.men),
        reason:
          "현재 선택된 남복 조합을 기준으로 후위 공격과 전위 마무리 역할이 분명한 조합을 유지하는 것이 좋습니다.",
        alternativePair: [],
        alternativeReason: "대안 조합 데이터가 충분하지 않습니다.",
        tip: "초반에는 깊은 클리어로 상대를 뒤로 밀고 기회를 만듭니다."
      }
    }
  };
}

/* =========================
   fallback: 상대 맞춤 전술
========================= */

function buildFallbackMatchTactics(actualLineups) {
  return {
    summary: {
      overallPlan:
        "현재는 AI 서버 호출에 실패하여 기본 맞춤 전술을 표시합니다. 초반에는 상대 후위를 먼저 확인하고, 전위 압박은 연결이 흔들릴 때 시도합니다."
    },
    women: {
      ourPair: normalizeArray(actualLineups?.myTeam?.women),
      oppPair: normalizeArray(actualLineups?.opponentTeam?.women),
      oppStyle:
        "상대 여복 조합의 최근 기록이 충분하지 않아 일반적인 수비형 조합으로 가정합니다.",
      attackPoint:
        "짧은 리턴 이후 전위 빈 공간을 먼저 확인하고, 후위로 밀었을 때 드롭 전환을 시도합니다.",
      warning:
        "초반부터 무리한 마무리를 시도하면 범실이 늘 수 있으므로 연결 안정성을 먼저 확보합니다.",
      openingPlan:
        "첫 2개 랠리는 깊은 클리어와 안정적인 연결로 상대 수비 패턴을 확인합니다."
    },
    mixed: {
      ourPair: normalizeArray(actualLineups?.myTeam?.mixed),
      oppPair: normalizeArray(actualLineups?.opponentTeam?.mixed),
      oppStyle:
        "상대 혼복 조합의 최근 기록이 충분하지 않아 전위-후위 분담형 조합으로 가정합니다.",
      attackPoint:
        "전위 처리 후 뒤로 복귀하는 선수를 흔들기 위해 짧은 드롭과 빠른 전환을 사용합니다.",
      warning:
        "혼복에서는 전위·후위 역할이 흐트러지면 실점이 빨라질 수 있으므로 역할을 분명히 유지합니다.",
      openingPlan:
        "첫 랠리에서는 무리한 공격보다 전위·후위 역할을 확인하고 연결 안정성을 먼저 봅니다."
    },
    men: {
      ourPair: normalizeArray(actualLineups?.myTeam?.men),
      oppPair: normalizeArray(actualLineups?.opponentTeam?.men),
      oppStyle:
        "상대 남복 조합의 최근 기록이 충분하지 않아 후위 공격 비중이 높은 조합으로 가정합니다.",
      attackPoint:
        "상대를 먼저 뒤로 밀어 후위 공격 타이밍을 줄이고, 전위에서 짧은 리턴 이후 빈 공간을 노립니다.",
      warning:
        "상대 후위 강공을 정면으로 받기보다 먼저 수비 위치를 안정시키고 랠리 길이를 조절합니다.",
      openingPlan:
        "첫 2개 랠리는 깊은 클리어로 상대 후위를 확인한 뒤, 전위 압박 여부를 판단합니다."
    }
  };
}

/* =========================
   1) 오더 추천 함수
========================= */

exports.generateTacticGuide = functions.https.onCall(async (data, context) => {
  try {
    const lineup = data?.lineup || {
      women: [],
      mixed: [],
      men: []
    };

    const stats = data?.stats || {
      myTeam: {
        winRate: 50,
        scoreDiff: 0,
        strengths: ["기본기"],
        weaknesses: ["수비 전환"],
        players: {},
        pairs: {}
      },
      opponentTeam: {
        winRate: 50,
        scoreDiff: 0,
        strengths: ["수비"],
        weaknesses: ["전위 수비"],
        players: {},
        pairs: {}
      }
    };

    const prompt = buildOrderRecommendationPrompt({ lineup, stats });
    const text = await callOpenAI(prompt);

    return { text };
  } catch (error) {
    console.error("generateTacticGuide error:", error);

    return {
      text: JSON.stringify(
        buildFallbackOrderRecommendation(data?.lineup || {})
      )
    };
  }
});

/* =========================
   2) 상대 맞춤 전술 함수
========================= */

exports.generateMatchTactics = functions.https.onCall(async (data, context) => {
  try {
    const actualLineups = data?.actualLineups || {
      myTeam: { women: [], mixed: [], men: [] },
      opponentTeam: { women: [], mixed: [], men: [] }
    };

    const stats = data?.stats || {
      myTeam: { players: {}, pairs: {} },
      opponentTeam: { players: {}, pairs: {} }
    };

    const prompt = buildMatchTacticsPrompt({ actualLineups, stats });
    const text = await callOpenAI(prompt);

    return { text };
  } catch (error) {
    console.error("generateMatchTactics error:", error);

    return {
      text: JSON.stringify(
        buildFallbackMatchTactics(data?.actualLineups || {})
      )
    };
  }
});