export async function getAccessToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get("tb_token", (result) => {
      resolve(result?.tb_token || "");
    });
  });
}

export async function loginWithGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: "https://YOUR-SUPABASE-URL/auth/v1/authorize?provider=google",
        interactive: true
      },
      (redirectUrl) => {
        if (!redirectUrl) {
          reject(new Error("Login cancelled"));
          return;
        }

        const url = new URL(redirectUrl);

        const accessToken =
          url.searchParams.get("access_token") ||
          new URLSearchParams(url.hash.slice(1)).get("access_token");

        if (!accessToken) {
          reject(new Error("No access token"));
          return;
        }

        chrome.storage.local.set({ tb_token: accessToken }, () => {
          resolve();
        });
      }
    );
  });
}
