/****************************************
*                                       *
* Windows 96 - b13751.4dea1f1e          *
* Copyright (C) MikeSoft 2026.          *
*                                       *
* All external licenses apply           *
*                                       *
*****************************************/
(() => {
    window.$96 = { isSigned: true };
    window.$loadKernel = async function() {
        delete window.$loadKernel;
        const response = await fetch('/system/libraries/kernel/sys-base/kernel.js');
        if (!response.ok) throw new Error('Missing local boot kernel (HTTP ' + response.status + ')');
        const source = await response.text();
        const script = document.createElement('script');
        script.textContent = source;
        document.head.appendChild(script);
        if (typeof window.w96 === 'undefined') throw new Error('The local boot kernel is invalid');
        return 0;
    };
})();
