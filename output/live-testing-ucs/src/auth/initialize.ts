if (!$ || typeof($.get) !== "function")
    throw new Error(`Jquery.js must be loaded before initializing user auth.`);

$.ajaxSetup({
    processData: false,
    contentType: "application/json",    
});