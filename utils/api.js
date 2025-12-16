export async function callTextBoiAPI(payload, token) {
  const res = await fetch("https://worker.textboi.ai/api", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("TextBoi API failed");
  }

  return res.json();
}
