<?php
/**
 * Handles the Configurator meta box UI and data saving.
 */
class CONFIGURATOR_Meta_Box
{
    public static function init()
    {
        add_action('add_meta_boxes', [self::class, 'register']);
        add_action('save_post_' . CONFIGURATOR_POST_TYPE, [self::class, 'save']);
    }

    public static function register()
    {
        add_meta_box(
            'configurator_meta',
            'Configurator Settings',
            [self::class, 'render'],
            CONFIGURATOR_POST_TYPE,
            'normal',
            'high'
        );
    }

    public static function render($post)
    {
        wp_nonce_field('configurator_save', 'configurator_nonce');

        $_configurator_model_url = get_post_meta($post->ID, '_configurator_model_url', true);
        $_configurator_config_json = get_post_meta($post->ID, '_configurator_config_json', true);
        $_configurator_base_price = get_post_meta($post->ID, '_configurator_base_price', true);
        ?>

        <div class="configurator-meta-box-content">
            <div class="builder-column">

                <p>
                    <label for="_configurator_model_url"><strong>Model (.glb) URL</strong></label><br>
                    <input type="text" id="_configurator_model_url" name="_configurator_model_url" value="<?php echo esc_attr($_configurator_model_url); ?>"
                        style="width:100%;" placeholder="https://.../model.glb" />
                </p>

                <p>
                    <button type="button" class="button" id="scan-materials">
                        Scan Model for Materials
                    </button>
                </p>

                <div id="materials-list">
                    <em>Click “Scan Model for Materials” after entering a valid GLB URL.</em>
                </div>

                <p style="margin-top:15px;">
                    <label for="_configurator_base_price"><strong>Base Price</strong></label><br>
                    <input type="number" step="0.01" id="_configurator_base_price" name="_configurator_base_price"
                        value="<?php echo esc_attr($_configurator_base_price); ?>" />
                </p>

                <hr>

                <p><strong>Configurator Builder</strong></p>

                <div id="builder-root" data-base-price="<?php echo esc_attr($_configurator_base_price); ?>">
                    <p>Loading builder...</p>
                </div>

                <textarea id="_configurator_config_json" name="_configurator_config_json" rows="10" style="width:100%; display:none;"><?php
                echo esc_textarea($_configurator_config_json);
                ?></textarea>

                <p style="margin-top:10px;">
                    <em>Shortcode:</em>
                    <code>[configurator id="<?php echo esc_attr($post->ID); ?>"]</code>
                </p>
            </div>

            <div class="viewer-column">
                <p><strong>3D Model Preview</strong></p>

                <div id="admin-viewer-wrap">
                    <model-viewer id="admin-model-viewer" src="<?php echo esc_url($_configurator_model_url); ?>" camera-controls auto-rotate
                        disable-zoom interaction-prompt="none" environment-image="neutral" shadow-intensity="1"
                        enable-for-material-picker style="width: 100%; height: 100%;">
                    </model-viewer>
                </div>
            </div>
        </div>
        <?php
    }

    public static function save($post_id)
    {
        if (!isset($_POST['configurator_nonce']))
            return;
        if (!wp_verify_nonce($_POST['configurator_nonce'], 'configurator_save'))
            return;
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
            return;
        if (get_post_type($post_id) !== CONFIGURATOR_POST_TYPE)
            return;

        if (isset($_POST['_configurator_model_url'])) {
            update_post_meta($post_id, '_configurator_model_url', esc_url_raw($_POST['_configurator_model_url']));
        }

        if (isset($_POST['_configurator_base_price'])) {
            update_post_meta($post_id, '_configurator_base_price', floatval($_POST['_configurator_base_price']));
        }

        if (isset($_POST['_configurator_config_json'])) {
            update_post_meta(
                $post_id,
                '_configurator_config_json',
                wp_kses_post(wp_unslash($_POST['_configurator_config_json']))
            );
        }
    }
}
