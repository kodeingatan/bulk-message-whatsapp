export function validateSheetName(value) {
  const name = String(value ?? "").trim();

  if (!name) return "Nama sheet tidak boleh kosong.";
  if (name.length > 31) return "Nama sheet maksimal 31 karakter.";
  if (/[\u0000-\u001f\\/?*[\]:]/.test(name)) {
    return 'Nama sheet tidak boleh mengandung karakter: \\ / ? * [ ] :';
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    return "Nama sheet tidak boleh diawali atau diakhiri tanda petik satu.";
  }

  return "";
}
