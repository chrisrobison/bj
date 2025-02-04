export default [
    ...myconfig,

    // anything from here will override myconfig
    {
        rules: {
            "no-unused-vars": "warn"
        }
    }
];
