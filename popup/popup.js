import { loginWithGoogle } from "../utils/auth.js";

const loginBtn = document.getElementById("login");

if (loginBtn) {
  loginBtn.addEventListener("click", loginWithGoogle);
}
