const menuButton = document.querySelector('.menu-button');
const header = document.querySelector('.site-header');

menuButton?.addEventListener('click', () => {
  const isOpen = header.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

document.querySelectorAll('.desktop-nav a').forEach((link) => {
  link.addEventListener('click', () => {
    header.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

const showcaseImage = document.querySelector('#showcaseImage');
document.querySelectorAll('.screen-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('.screen-tabs button.active')?.classList.remove('active');
    button.classList.add('active');
    showcaseImage.style.opacity = '0';
    window.setTimeout(() => {
      showcaseImage.src = `../docs/manual-assets/${button.dataset.screen}`;
      showcaseImage.style.opacity = '1';
    }, 180);
  });
});
