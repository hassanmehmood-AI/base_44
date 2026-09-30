(function () {
  try {
    var t = localStorage.getItem("crm-color-theme");
    var d = localStorage.getItem("crm-design-system");
    document.documentElement.setAttribute("data-theme", t === "blue" || t === "gray" || t === "orange" ? t : "blue");
    document.documentElement.setAttribute("data-design", d === "bento" || d === "brutalist" || d === "aurora" ? d : "bento");
  } catch (e) {}
})();
