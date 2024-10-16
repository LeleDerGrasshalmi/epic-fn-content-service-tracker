if (!$ || typeof($) !== "function")
    throw new Error(`Jquery.js must be loaded before initializing keyboard shortcuts.`)

$(window).on("keydown", (event) => {
    // CTRL + S (SAVE)
    if ((event.which == 83 && event.ctrlKey)) {
        event.preventDefault();
        return false;
    }
    return true;
});