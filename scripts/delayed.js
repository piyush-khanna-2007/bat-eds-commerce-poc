import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { getUserTokenCookie } from './initializers/index.js';
import { getConsent } from './commerce.js';

async function initAnalytics() {
  try {
    // Load Commerce events SDK and collector
    // only if "analytics" has been added to the config.
    const analyticsConfig = getConfigValue('analytics');

    if (analyticsConfig && getConsent('commerce-collection')) {
      window.adobeDataLayer.push(
        {
          storefrontInstanceContext: {
            baseCurrencyCode: analyticsConfig['base-currency-code'],
            environment: analyticsConfig.environment,
            environmentId: analyticsConfig['environment-id'],
            storeCode: analyticsConfig['store-code'],
            storefrontTemplate: 'EDS',
            storeId: parseInt(analyticsConfig['store-id'], 10),
            storeName: analyticsConfig['store-name'],
            storeUrl: analyticsConfig['store-url'],
            storeViewCode: analyticsConfig['store-view-code'],
            storeViewCurrencyCode: analyticsConfig['base-currency-code'],
            storeViewId: parseInt(analyticsConfig['store-view-id'], 10),
            storeViewName: analyticsConfig['store-view-name'],
            websiteCode: analyticsConfig['website-code'],
            websiteId: parseInt(analyticsConfig['website-id'], 10),
            websiteName: analyticsConfig['website-name'],
            viewId: analyticsConfig['view-id'], // applicable for ACO storefronts
            // setting locale if defined, applicable for ACO storefronts
            ...(analyticsConfig.locale && { locale: analyticsConfig.locale }),
          },
        },
        {
          eventForwardingContext: {
            commerce: true,
            aep: !!(analyticsConfig['aep-ims-org-id'] && analyticsConfig['aep-datastream-id']),
          },
        },
        {
          shopperContext: {
            shopperId: getUserTokenCookie() ? 'logged-in' : 'guest',
          },
        },
        {
          aepContext: {
            imsOrgId: analyticsConfig['aep-ims-org-id'],
            datastreamId: analyticsConfig['aep-datastream-id'],
          },
        },
      );

      // Load events SDK and collector
      import('./commerce-events-sdk.js');
      import('./commerce-events-collector.js');
    }
  } catch (error) {
    console.warn('Error initializing analytics', error);
  }
}

function loadAdobeLaunch() {
  try {
    const launchEnabled = getConfigValue('launchEnabled');
    const launchScript = getConfigValue('launchScript');

    console.log('Adobe Launch config:', {
      launchEnabled,
      launchScript,
    });

    const isEnabled = String(launchEnabled).toLowerCase() === 'true';

    if (!isEnabled || !launchScript) {
      console.warn('Adobe Launch is disabled or the script URL is missing');
      return;
    }

    if (document.querySelector(`script[src="${launchScript}"]`)) {
      console.log('Adobe Launch script already exists');
      return;
    }

    const script = document.createElement('script');
    script.src = launchScript;
    script.async = true;

    script.addEventListener('load', () => {
      console.log('Adobe Launch script downloaded successfully');
    });

    script.addEventListener('error', () => {
      console.error(
        'Adobe Launch script could not be downloaded:',
        launchScript,
      );
    });

    document.head.appendChild(script);

    console.log('Adobe Launch script appended:', launchScript);
  } catch (error) {
    console.warn('Failed to initialize Adobe Launch', error);
  }
}

if (document.prerendering) {
  document.addEventListener('prerenderingchange', () => {
    initAnalytics();
    loadAdobeLaunch();
  }, { once: true });
} else {
  initAnalytics();
  loadAdobeLaunch();
}

// add delayed functionality here
