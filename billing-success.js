// 플랜 정보를 storage에서 읽어 배지 텍스트 업데이트
chrome.storage.local.get("tb_current_plan", ({ tb_current_plan }) => {
  if (!tb_current_plan) return;
  const type = (tb_current_plan.plan_type || "basic");
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const badge = document.getElementById("plan-badge");
  if (badge) badge.textContent = `${label} Plan`;
});
