(() => {
    const currentScript = document.currentScript;
    const moduleUrl = currentScript
        ? new URL('./scanner/admin-material-scanner.js', currentScript.src)
        : './scanner/admin-material-scanner.js';

    import(moduleUrl).catch((error) => {
        console.error('Failed to load material scanner module.', error);
    });
})();
