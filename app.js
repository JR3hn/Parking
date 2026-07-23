const form = document.getElementById("parkForm");
const submitBtn = document.getElementById("submitBtn");
const formMsg = document.getElementById("formMsg");

function setMsg(text, type) {
  formMsg.textContent = text;
  formMsg.className = "msg" + (type ? " " + type : "");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  setMsg("Sparar...", "");

  const payload = {
    website: document.getElementById("website").value,
    fornamn: document.getElementById("fornamn").value.trim(),
    efternamn: document.getElementById("efternamn").value.trim(),
    telefon: "'" + document.getElementById("telefon").value.trim(),
    regnr: document.getElementById("regnr").value.trim().toUpperCase(),
    slutdatum: document.getElementById("slutdatum").value,
    grupp: document.getElementById("grupp").value,
  };

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Okänt fel");
    setMsg("Registrerat! Ha en trevlig vistelse!", "ok");
    form.reset();
  } catch (err) {
    setMsg("Kunde inte spara: " + err.message, "err");
  } finally {
    submitBtn.disabled = false;
  }
});
