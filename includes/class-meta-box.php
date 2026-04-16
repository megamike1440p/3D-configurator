<?php
/**
 * Meta box for configurator settings
 */
function clc_cfg_add_meta_boxes()
{
    add_meta_box(
        'configurator_meta',
        'Configurator Settings',
        'clc_cfg_render_meta_box',
        'configurator',
        'normal',
        'high'
    );
}
add_action('add_meta_boxes', 'clc_cfg_add_meta_boxes');

function clc_cfg_render_meta_box($post)
{
    wp_nonce_field('configurator_save', 'configurator_nonce');

    $model_url = get_post_meta($post->ID, '_clc_model_url', true);
    $config_json = get_post_meta($post->ID, '_clc_config_json', true);
    $base_price = get_post_meta($post->ID, '_clc_base_price', true);
    ?>

    <div class="clc-configurator-meta-box-content">
        <div class="clc-builder-column">

            <p>
                <label for="clc_model_url"><strong>Model (.glb) URL</strong></label><br>
                <input type="text" id="clc_model_url" name="clc_model_url" value="<?php echo esc_attr($model_url); ?>"
                    style="width:100%;" placeholder="https://.../model.glb" />
            </p>

            <p>
                <button type="button" class="button" id="clc-scan-materials">Scan Model for Materials</button>
            </p>
            <div id="clc-materials-list">
                <em>Click “Scan Model for Materials” after entering a valid GLB URL to see all material names in the
                    model.</em>
            </div>

            <p style="margin-top:15px;">
                <label for="clc_base_price"><strong>Base Price (numeric)</strong></label><br>
                <input type="number" step="0.01" id="clc_base_price" name="clc_base_price"
                    value="<?php echo esc_attr($base_price); ?>" />
            </p>

            <hr>

            <p><strong>Configurator Builder</strong></p>
            <p>
                Use the builder UI below to add categories and options.
                This will generate the JSON configuration used on the frontend.
            </p>

            <div id="clc-builder-root" data-base-price="<?php echo esc_attr($base_price); ?>">
                <p>Loading builder...</p>
            </div>

            <textarea id="clc_config_json" name="clc_config_json" rows="10" style="width:100%; display:none;"><?php
            echo esc_textarea($config_json);
            ?></textarea>

            <p style="margin-top:10px;">
                <em>Shortcode:</em>
                <code>[cl_configurator id="<?php echo esc_attr($post->ID); ?>"]</code>
            </p>
        </div>
        <div class="clc-viewer-column">
            <p style="margin-top: 0;"><strong>3D Model Preview</strong></p>
            <div id="clc-admin-viewer-wrap">
                <model-viewer id="clc-admin-model-viewer" src="<?php echo esc_url($model_url); ?>" camera-controls
                    auto-rotate disable-zoom interaction-prompt="none" environment-image="neutral" shadow-intensity="1"
                    enable-for-material-picker style="width: 100%; height: 100%;">
                </model-viewer>

            </div>
        </div>
    </div>
    <?php
}
function clc_cfg_save_meta($post_id)
{
    if (!isset($_POST['configurator_nonce']))
        return;
    if (!wp_verify_nonce($_POST['configurator_nonce'], 'configurator_save'))
        return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
        return;
    if (get_post_type($post_id) !== 'configurator')
        return;

    if (isset($_POST['clc_model_url'])) {
        update_post_meta($post_id, '_clc_model_url', esc_url_raw($_POST['clc_model_url']));
    }

    if (isset($_POST['clc_base_price'])) {
        update_post_meta($post_id, '_clc_base_price', floatval($_POST['clc_base_price']));
    }

    if (isset($_POST['clc_config_json'])) {
        update_post_meta($post_id, '_clc_config_json', wp_kses_post(wp_unslash($_POST['clc_config_json'])));
    }
}
add_action('save_post_configurator', 'clc_cfg_save_meta');
