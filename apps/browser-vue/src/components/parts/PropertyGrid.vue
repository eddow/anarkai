<template>
    <div class="property-grid-container">
        <table class="property-grid">
            <tbody>
                <slot></slot>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.property-grid-container {
    background-color: var(--pico-card-background-color);
    border: 1px solid var(--pico-muted-border-color);
    border-radius: 4px;
    overflow: hidden;
}

.property-grid {
    width: 100%;
    border-collapse: collapse;
    margin: 0; 
}

/* Pico puts margin on tables, reset it */
.property-grid {
    margin-bottom: 0;
}
</style>
