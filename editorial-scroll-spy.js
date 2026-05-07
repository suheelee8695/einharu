(function () {
  const navLinks = document.querySelectorAll('.faq-sidebar nav a[href^="#"]');
  if (!navLinks.length) return;

  const sections = Array.from(navLinks)
    .map(link => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);

  function setActive(id) {
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + id);
    });
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: '-15% 0px -75% 0px', threshold: 0 }
  );

  sections.forEach(s => observer.observe(s));

  // Set initial active state based on scroll position on load
  setActive(sections[0].id);
})();
