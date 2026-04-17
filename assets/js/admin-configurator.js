(() => {
    const currentScript = document.currentScript;
    const moduleUrl = currentScript
        ? new URL('./admin/admin-configurator.js', currentScript.src)
        : './admin/admin-configurator.js';

    import(moduleUrl).catch((error) => {
        console.error('Failed to load admin configurator module.', error);
    });
})();
