export default async function loadAdobeLaunch() {
  try {
    const response = await fetch('/config.json');

    if (!response.ok) {
      return;
    }

    const config = await response.json();

    if (config.launchEnabled !== 'true') {
      return;
    }

    if (!config.launchScript) {
      return;
    }

    const script = document.createElement('script');

    script.src = config.launchScript;
    script.async = true;

    document.head.appendChild(script);

    console.log('Adobe Launch loaded');
  } catch (error) {
    console.error('Adobe Launch load failed', error);
  }
}
