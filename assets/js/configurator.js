(() => {
    const currentScript = document.currentScript;
    const moduleUrl = currentScript
        ? new URL('./configurator/configurator.js', currentScript.src)
        : './configurator/configurator.js';

    import(moduleUrl).catch((error) => {
        console.error('Failed to load configurator module.', error);
    });
})();
